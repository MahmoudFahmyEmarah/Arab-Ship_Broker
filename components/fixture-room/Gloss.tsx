"use client";

// Hover glossary: standard chartering abbreviations inside a value or hint
// get a title tooltip (design: fx-abbr). Pure presentation.
import * as React from "react";
import { glossTokens } from "@/lib/fixture-room/glossary";

export function Gloss({ text }: { text: string | null | undefined }) {
  const toks = glossTokens(text);
  if (toks.length === 0) return null;
  return (
    <>
      {toks.map((t, i) => (t.full ? <abbr key={i} className="fx-abbr" title={t.full}>{t.tok}</abbr> : <React.Fragment key={i}>{t.tok}</React.Fragment>))}
    </>
  );
}
