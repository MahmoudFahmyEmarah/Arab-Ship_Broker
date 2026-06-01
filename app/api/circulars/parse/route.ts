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

  let text: string;
  try {
    const body = await req.json();
    text = body?.text;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  const client = new Anthropic();

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
      messages: [
        {
          role: "user",
          content:
            `Today's date for laycan parsing: ${today}.\n\n` +
            `Parse the following circular and return JSON only:\n\n${text}`,
        },
      ],
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
