import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const isPublicRoute =
    pathname === "/" ||
    pathname.startsWith("/services") ||
    pathname.startsWith("/contact") ||
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
    return redirectWithSupabaseCookies("/auth/login?error=account_suspended");
  }

  if (!user.email_confirmed_at) {
    if (isVerifyEmailRoute) return supabaseResponse;

    const verifyUrl = new URL("/auth/verify-email", request.url);
    if (user.email) {
      verifyUrl.searchParams.set("email", user.email);
    }
    return redirectWithSupabaseCookies(verifyUrl);
  }

  const userRole = appUser?.role;

  if (isAuthRoute) {
    if (userRole === "admin") {
      return redirectWithSupabaseCookies("/admin/dashboard");
    }
    return redirectWithSupabaseCookies("/dashboard");
  }

  if (isPublicRoute) return supabaseResponse;

  if (userRole === "admin") {
    if (isAdminRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/admin/dashboard");
  }

  const isDashboardRole = (
    ["cargo_owner", "vessel_owner", "broker"] as string[]
  ).includes(userRole ?? "");

  if (isDashboardRole) {
    if (isDashboardRoute) return supabaseResponse;
    return redirectWithSupabaseCookies("/dashboard");
  }

  await supabase.auth.signOut();
  return redirectWithSupabaseCookies("/auth/login");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
