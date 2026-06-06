import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Anthropic from "@anthropic-ai/sdk";
import { CIRCULAR_SYSTEM_PROMPT } from "@/lib/circulars/prompt";
import type { CircularParseResult } from "@/lib/circulars/types";

export const runtime = "nodejs";

// Pull the first balanced JSON object out of the model output, tolerating
// any stray prose or code fences.
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Parser is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
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
  // Q88 / circular document path: PDF only, ~6MB cap (base64 is ~33% larger).
  if (hasFile) {
    if (fileMediaType !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF documents are supported (e.g. a Q88)." }, { status: 415 });
    }
    if (fileBase64!.length > 8_500_000) {
      return NextResponse.json({ error: "Document is too large (max ~6MB)." }, { status: 413 });
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const client = new Anthropic();

  // Build the user turn: a document block for an uploaded Q88/PDF, plus the
  // instruction; or the pasted text. Both run through the same system prompt.
  const userContent: Anthropic.MessageParam["content"] = hasFile
    ? [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fileBase64! },
        },
        {
          type: "text",
          text:
            `Today's date for laycan parsing: ${today}.\n\n` +
            `The attached PDF is a vessel Q88 (or a market circular). Extract the vessel/cargo ` +
            `fields and return JSON only.` +
            (hasText ? `\n\nAdditional context:\n${text}` : ""),
        },
      ]
    : `Today's date for laycan parsing: ${today}.\n\n` +
      `Parse the following circular and return JSON only:\n\n${text}`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      // Static prompt first (prompt-cacheable); the per-day date lives in the
      // user turn so it never invalidates the cached prefix.
      system: [
        {
          type: "text",
          text: CIRCULAR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = extractJson(raw) as CircularParseResult;
    return NextResponse.json(parsed);
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
