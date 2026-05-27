// ============================================================
// ARAB SHIPBROKER — AI CIRCULAR PARSER
// Supabase Edge Function (Deno runtime)
// Takes raw email / WhatsApp circular text and extracts structured
// cargo OR vessel position data for one-click form pre-fill.
// ============================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const ANTHROPIC_MODEL = "claude-opus-4-7"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
}

// ─── PROMPT — the heart of the parser ─────────────────────────
const SYSTEM_PROMPT = `You are an experienced dry bulk and break bulk shipbroker analyst.
You read circulars (cargo offers and vessel positions) sent over email and WhatsApp by brokers,
operators, and owners, and you extract them into clean structured data for a brokerage platform.

You understand maritime shorthand fluently. Common terms include:

CARGO terms:
- MOLOO / MOLOA: More or Less Owner's Option / Charterer's Option (±% on cargo qty)
- FIO/FIOT/FIOST/FIOS: Free In/Out variants (load terms)
- SSHEX / SHEX / SHINC / SSHINC / FSHEX / BENDS / EIU / PWWD: Laytime qualifiers
- TTL: Total laytime (not split)
- SF: Stowage factor (m³/t — values >0.83 are cubic-out)
- WOG: Without Guarantee — cargo offered without firm commitment, always flag
- INOO: In Owner's Option
- DDGS, MSDS: Common acronyms (don't expand)
- IMSBC group A/B/C: Cargo safety category
- SPOT / PROMPT: immediate laycan (no specific date)

VESSEL terms:
- DWT vs DWCC: design vs commercial intake (DWCC binds matchmaking)
- SID: Single Deck (gearless box)
- BUG: Box Underdeck Geared
- BOX / NON-BOX: hold shape
- TC / TCT / VC: Time Charter / TC Trip / Voyage Charter
- DNR: Do Not Repeat (broker note — owner does not want listing recirculated)
- AOH: After Office Hours

ZONES used by this broker:
B.SEA (Black Sea), E.MED (East Med), W.MED (West Med), C.MED (Central Med),
ADRIATIC, R.SEA (Red Sea), AG (Arabian Gulf), A.SEA (Arabian Sea),
WCAF (West Africa), ECAF (East Africa), NCONT (North Continent),
CARIB (Caribbean), F.EAST (Far East), ECI (East Coast India)

LOCODE format: 5 uppercase letters, country code + port code (e.g. EGALY = Alexandria Egypt,
SAJED = Jeddah Saudi, ROCND = Constanta Romania, UAODS = Odessa Ukraine).

Output JSON ONLY. No prose, no markdown, no code fences. Structure:

{
  "kind": "cargo" | "vessel" | "unknown",
  "confidence": 0.0-1.0,
  "extracted": { ... fields ... },
  "warnings": [ "string" ],
  "raw_intent": "short summary of what was offered"
}

For CARGO, extract these fields when present (omit if absent):
{
  "cargo_type": "Dry Bulk" | "Break Bulk",
  "commodity_name": "Wheat" | "Steel Coils" | ...,
  "qty_min_mt": number,
  "qty_max_mt": number,
  "load_port_locode": "EGALY",
  "load_port_name": "Alexandria",
  "disch_port_locode": "SAJED",
  "disch_port_name": "Jeddah",
  "laycan_from": "YYYY-MM-DD" or null if SPOT,
  "laycan_to": "YYYY-MM-DD" or null,
  "is_spot": true | false,
  "load_rate": "3,000 SSHEX",
  "disch_rate": "2,000",
  "load_terms": "FIO" | "FIOT" | "FIOST" | "FIOS" | "FIOS LSD" | "Liner Terms",
  "laytime_qualifier": "SSHEX BENDS",
  "freight_idea_usd_mt": 45,
  "commission_pct": 2.5,
  "is_wog": true | false,
  "is_grain_cargo": true | false,
  "is_dg_cargo": true | false,
  "stowage_factor": 1.30,
  "max_vessel_age_yr": 25,
  "max_loa_m": 140,
  "max_draft_m": 7.5,
  "requires_geared": true | false,
  "notes": "any extras"
}

For VESSEL, extract:
{
  "vessel_name": "MV ATLAS",
  "imo_number": "9876543",
  "vessel_type": "General Cargo" | "Bulk Carrier" | "Other",
  "dwt_grain": 8200,
  "dwcc": 7500,
  "build_year": 2006,
  "flag": "Panama",
  "max_loa_m": 110,
  "max_draft_m": 7.2,
  "is_geared": true | false,
  "crane_count": 3,
  "crane_swl_mt": 30,
  "grain_cbm": 11000,
  "open_port_locode": "GRATH",
  "open_port_name": "Aegean",
  "open_zone": "E.MED",
  "open_date": "YYYY-MM-DD" or null,
  "is_spot": true | false,
  "open_date_range_days": 3,
  "last_cargo": "Wheat",
  "vlsfo_sea_mt_day": 23.5,
  "lsmgo_sea_mt_day": 0.5,
  "service_speed_kn": 12.5,
  "preferred_zones": ["B.SEA","E.MED"],
  "freight_idea_usd_mt": 42,
  "commission_pct": 2.5,
  "notes": "DNR / restrictions / etc"
}

Warnings should flag:
- WOG offered
- Cargo outside ASB niche (>20K DWT or non-core zone)
- Vessel sanctioned region
- IMO Class A liquefaction cargo (e.g. iron ore fines, coal slurry)
- Grain Code requirement
- Suspicious or contradictory data
- Missing critical fields (load port, qty)

Today's date for laycan parsing: ${new Date().toISOString().split('T')[0]}.`

// ─── HANDLER ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }

  try {
    const { text } = await req.json()
    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'text' field" }),
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `Parse the following circular and return JSON only:\n\n${text}` }
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return new Response(
        JSON.stringify({ error: "Anthropic API error", details: errText }),
        { status: 500, headers: CORS_HEADERS }
      )
    }

    const data = await response.json()
    const rawOutput = data.content?.[0]?.text ?? ""

    // Strip any markdown fences
    let cleanJson = rawOutput.trim()
    cleanJson = cleanJson.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "")

    let parsed: any
    try {
      parsed = JSON.parse(cleanJson)
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "Failed to parse model output as JSON",
          raw_output: rawOutput
        }),
        { status: 500, headers: CORS_HEADERS }
      )
    }

    return new Response(JSON.stringify(parsed), { headers: CORS_HEADERS })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: CORS_HEADERS }
    )
  }
})
