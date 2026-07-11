// EmailLlmSource — the SyncSource for LLM-classified message channels (email or
// WhatsApp). It carries the sheets already produced by the classification and
// hands them to stageBatch exactly like XlsxSource, so nothing downstream knows
// or cares about the origin beyond the source label.

import type { ParsedSheet, SyncSource } from "./types";

export class EmailLlmSource implements SyncSource {
  readonly kind: "email" | "whatsapp";
  constructor(
    private readonly sheets: ParsedSheet[],
    kind: "email" | "whatsapp" = "email",
  ) {
    this.kind = kind;
  }
  async parse(): Promise<ParsedSheet[]> {
    return this.sheets;
  }
}
