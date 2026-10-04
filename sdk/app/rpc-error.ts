export class AppRpcError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  readonly rpc: string;

  constructor(rpc: string, error: { message: string; code?: string | null; details?: string | null; hint?: string | null }) {
    const code = error.code || null;
    const details = error.details || null;
    const hint = error.hint || null;
    const context = [code ? `code ${code}` : null, details, hint].filter(Boolean).join(" · ");
    super(context ? `${error.message} (${context})` : error.message);
    this.name = "AppRpcError";
    this.rpc = rpc;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

export function throwAppRpcError(
  rpc: string,
  error: { message: string; code?: string | null; details?: string | null; hint?: string | null },
): never {
  throw new AppRpcError(rpc, error);
}
