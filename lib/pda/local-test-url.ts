const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Destructive browser fixtures may only target an exact local loopback host.
 * Parsing first prevents a loopback-looking path, query, credential, or parent
 * domain from bypassing the guard.
 */
export function isExactLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
