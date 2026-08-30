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

  // ── Fail OPEN on ambiguity. getUser() fails for two very different
  // reasons: Supabase explicitly rejecting the session (signed out — status
  // 4xx), or a transient failure reaching Supabase at all (network blip,
  // 5xx, thrown "fetch failed"). Only the former means "logged out"; the
  // latter must let the request through untouched, otherwise every blip
  // bounces a perfectly valid session to the login page.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let authUnavailable = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    if (!user && error) {
      const status = (error as { status?: number }).status;
      authUnavailable =
        error.name === "AuthRetryableFetchError" || !status || status >= 500;
    }
  } catch {
    authUnavailable = true;
  }

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
      // signOut can itself throw on a network failure — the redirect (which
      // clears the auth cookies) must still go out either way.
      try { await supabase.auth.signOut(); } catch {}
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
    // Transient auth outage: pass the request through with the session
    // cookies intact — the next request recovers. Never redirect to login
    // here, and never touch the refresh token.
    if (authUnavailable) return supabaseResponse;
    if (isPublicRoute || isAuthRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/auth/login");
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("role, is_active, trust_tier")
    .eq("id", user.id)
    .maybeSingle();

  // Same fail-open rule for the role lookup: a failed QUERY (network blip,
  // DB hiccup) is not a missing account. The old code fell through to a
  // GLOBAL signOut here, revoking the refresh token over a one-off hiccup —
  // that was the main source of the random logouts. Only a query that
  // SUCCEEDS and finds no row / an unknown role may end the session.
  if (appUserError) return supabaseResponse;

  if (appUser && !appUser.is_active) {
    try { await supabase.auth.signOut(); } catch {}
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

  // Reached only when the users query SUCCEEDED yet found no row or an
  // unrecognized role — a genuinely broken account, not a hiccup.
  try { await supabase.auth.signOut(); } catch {}
  const res = redirectWithSupabaseCookies("/auth/login");
  res.cookies.delete(LAST_ACTIVE_COOKIE);
  return res;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
