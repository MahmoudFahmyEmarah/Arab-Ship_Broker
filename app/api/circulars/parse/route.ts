import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Anthropic from "@anthropic-ai/sdk";
import { spreadsheetToText } from "@/lib/circulars/extract";
import { hasAnthropicKey, runCircularExtraction } from "@/lib/circulars/engine";

export const runtime = "nodejs";

// ── input limits ────────────────────────────────────────────────────────────
const MAX_TEXT_CHARS = 60_000; // pasted circular / Q88 text
const MAX_FILE_B64 = 8_500_000; // ~6MB binary

const XLSX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
]);

export async function POST(req: Request) {
  // ── Auth gate: only authenticated members may use the parser ──
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let text: string | undefined;
  let fileBase64: string | undefined;
  let fileMediaType: string | undefined;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : undefined;
    fileBase64 = typeof body?.fileBase64 === "string" ? body.fileBase64 : undefined;
    fileMediaType = typeof body?.fileMediaType === "string" ? body.fileMediaType : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const hasText = !!text && text.trim().length > 0;
  const hasFile = !!fileBase64;
  if (!hasText && !hasFile) {
    return NextResponse.json({ error: "Provide circular text or a document to parse." }, { status: 400 });
  }
  if (hasText && text!.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "Pasted text is too long (max 60,000 characters)." }, { status: 413 });
  }

  // Q88 / circular document path: PDF or Excel (Q88s circulate as .xlsx), ~6MB cap.
  let sheetText: string | undefined;
  let pdfBase64: string | undefined;
  if (hasFile) {
    if (fileBase64!.length > MAX_FILE_B64) {
      return NextResponse.json({ error: "Document is too large (max ~6MB)." }, { status: 413 });
    }
    if (XLSX_TYPES.has(fileMediaType ?? "")) {
      try {
        sheetText = spreadsheetToText(fileBase64!);
      } catch {
        return NextResponse.json({ error: "Could not read that spreadsheet — is it a valid Excel file?" }, { status: 415 });
      }
      if (!sheetText.trim()) {
        return NextResponse.json({ error: "That spreadsheet appears to be empty." }, { status: 415 });
      }
    } else if (fileMediaType === "application/pdf") {
      pdfBase64 = fileBase64;
    } else {
      return NextResponse.json(
        { error: "Only PDF or Excel documents are supported (e.g. a Q88)." },
        { status: 415 },
      );
    }
  }

  if (!hasAnthropicKey() && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Parser is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  try {
    const outcome = await runCircularExtraction({ text: hasText ? text : undefined, sheetText, pdfBase64 });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    return NextResponse.json(outcome.result);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Parser API error (${err.status ?? "?"})` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Failed to parse circular output as JSON. Try rephrasing the text." },
      { status: 502 },
    );
  }
}
