// A Ports Module page that cannot load its records shows an honest fallback; this records WHY on the server, so an
// operator can tell a transient read failure from a defect. Only the surface and the error message are logged.
export function logPdaLoadFailure(surface: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ports-da] ${surface} could not be loaded: ${message}`);
}
