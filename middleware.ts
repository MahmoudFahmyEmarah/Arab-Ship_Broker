import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { normalizeRole } from "@/lib/role";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const redirectWithSupabaseCookies = (target: URL | string) => {
    const redirectUrl =
      typeof target === "string" ? new URL(target, request.url) : target;
    const redirectResponse = NextResponse.redirect(redirectUrl);

    supabaseResponse.cookies.getAll().forEach((cookie) => {
      const { name, value, ...options } = cookie;
      redirectResponse.cookies.set(name, value, options);
    });

    return redirectResponse;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const url = request.nextUrl;
  const pathname = url.pathname;

  // Handle password reset code in query string
  const code = url.searchParams.get("code");
  if (code && (pathname === "/" || pathname.startsWith("/auth/callback"))) {
    const redirectUrl = new URL("/auth/reset-password", request.url);
    redirectUrl.searchParams.set("code", code);
    return redirectWithSupabaseCookies(redirectUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Inactivity timeout: sessions expire after 30 minutes without a page
  // visit. Every authenticated request rolls the window forward; a request
  // arriving after the window is signed out server-side (the refresh token is
  // revoked, so the session cannot be silently renewed) and bounced to login.
  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  const LAST_ACTIVE_COOKIE = "asb-last-active";
  if (user) {
    const lastActive = Number(request.cookies.get(LAST_ACTIVE_COOKIE)?.value ?? NaN);
    // The cookie only counts if it was written during THIS session. It is
    // httpOnly, so a client-side sign-out cannot clear it — after a manual
    // logout (or an overnight session lapse) it lingers with the OLD
    // timestamp, and without this guard the very first navigation of a
    // brand-new login would be "idle for hours" and get signed out on the
    // spot. A stale cookie is ignored and simply re-rolled below.
    const signedInAt = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
    const fromThisSession = Number.isFinite(lastActive) && lastActive >= signedInAt;
    if (fromThisSession && Date.now() - lastActive > IDLE_LIMIT_MS) {
      await supabase.auth.signOut();
      const res = redirectWithSupabaseCookies("/auth/login?error=session_expired");
      res.cookies.delete(LAST_ACTIVE_COOKIE);
      return res;
    }
    supabaseResponse.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }

  const isPublicRoute =
    pathname === "/" ||
    pathname.startsWith("/services") ||
    pathname.startsWith("/contact") ||
    pathname.startsWith("/market-insights") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/legal");

  const isAuthRoute = pathname.startsWith("/auth/");
  const isVerifyEmailRoute = pathname.startsWith("/auth/verify-email");
  const isAdminRoute = pathname.startsWith("/admin");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  if (!user) {
    if (isPublicRoute || isAuthRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/auth/login");
  }

  const { data: appUser } = await supabase
    .from("users")
    .select("role, is_active, trust_tier")
    .eq("id", user.id)
    .single();

  if (appUser && !appUser.is_active) {
    await supabase.auth.signOut();
    const res = redirectWithSupabaseCookies("/auth/login?error=account_suspended");
    res.cookies.delete(LAST_ACTIVE_COOKIE);
    return res;
  }

  if (!user.email_confirmed_at) {
    if (isVerifyEmailRoute) return supabaseResponse;

    const verifyUrl = new URL("/auth/verify-email", request.url);
    if (user.email) {
      verifyUrl.searchParams.set("email", user.email);
    }
    return redirectWithSupabaseCookies(verifyUrl);
  }

  const userRole = normalizeRole(appUser?.role);

  if (isAuthRoute) {
    // Password recovery: verifying the OTP creates a session, and the user
    // then NEEDS /auth/reset-password to set the new password — bouncing
    // them to the dashboard here would strand the whole recovery flow.
    if (pathname.startsWith("/auth/reset-password")) return supabaseResponse;
    // Admins are brokers-who-administer: land them in the portal (same UI),
    // with the Admin tools available in the portal sidebar.
    return redirectWithSupabaseCookies("/dashboard");
  }

  if (isPublicRoute) return supabaseResponse;

  if (userRole === "admin") {
    // Admins may use BOTH the portal and the admin tool pages (both now render
    // in the same portal shell). Only bounce them off non-app routes.
    if (isAdminRoute || isDashboardRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/dashboard");
  }

  const isDashboardRole = (
    ["cargo_owner", "vessel_owner", "broker"] as string[]
  ).includes(userRole ?? "");

  if (isDashboardRole) {
    if (isDashboardRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/dashboard");
  }

  await supabase.auth.signOut();
  const res = redirectWithSupabaseCookies("/auth/login");
  res.cookies.delete(LAST_ACTIVE_COOKIE);
  return res;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
