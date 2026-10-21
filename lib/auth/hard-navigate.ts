// Crossing the sign-in boundary must reload the document, not navigate client-side.
// The Next router keeps prefetched route responses in the browser. Prefetched while
// signed out, every /dashboard link holds the proxy's "go to /auth/login" redirect;
// after a client-side router.push("/dashboard") those cached redirects survive, so
// the next click on a calculator lands on the login form although the session is
// valid (owner report, 18 Oct 2026). The same holds in reverse after signing out
// (cached portal pages). A full navigation drops the router cache entirely.
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
