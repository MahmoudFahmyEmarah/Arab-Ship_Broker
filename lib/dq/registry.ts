// UN/LOCODE registry import (server only). Accepts the UNECE CSV code list
// (CodeListPart1/2/3.csv — no header: Change, Country, Location, Name,
// NameWoDiacritics, SubDiv, Function, Status, Date, IATA, Coordinates,
// Remarks) or a headed CSV export with the same fields, upserts
// unlocode_registry keyed by the 5-char code, and records the release.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RegistryRow {
  code: string; country: string; location: string; name: string | null; name_wo_diacritics: string | null; subdivision: string | null;
  function: string | null; status: string | null; date: string | null; iata: string | null; coordinates: string | null;
  lat: number | null; lng: number | null; remarks: string | null; release: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); if (row.some((c) => c !== "")) rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((c) => c !== "")) rows.push(row); }
  return rows;
}

/** "2534N 05517E" → { lat: 25.567, lng: 55.283 } */
export function parseCoordinates(s: string | null | undefined): { lat: number | null; lng: number | null } {
  const m = (s ?? "").trim().match(/^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/i);
  if (!m) return { lat: null, lng: null };
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3].toUpperCase() === "S" ? -1 : 1);
  const lng = (Number(m[4]) + Number(m[5]) / 60) * (m[6].toUpperCase() === "W" ? -1 : 1);
  return { lat: Math.round(lat * 100000) / 100000, lng: Math.round(lng * 100000) / 100000 };
}

const HEADER_KEYS: Record<string, keyof RegistryRow | "change"> = {
  change: "change", country: "country", location: "location", name: "name", namewodiacritics: "name_wo_diacritics", nameWoDiacritics: "name_wo_diacritics",
  subdiv: "subdivision", subdivision: "subdivision", function: "function", status: "status", date: "date", iata: "iata", coordinates: "coordinates", remarks: "remarks",
};

export function parseRegistryCsv(text: string, release: string, countries?: Set<string>): RegistryRow[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  let idx: Partial<Record<keyof RegistryRow | "change", number>> = {};
  let start = 0;
  const first = rows[0].map((c) => c.trim().toLowerCase().replace(/[^a-z]/g, ""));
  if (first.includes("country") && first.includes("location")) {
    first.forEach((h, i) => { const k = HEADER_KEYS[h]; if (k) idx[k] = i; });
    start = 1;
  } else {
    idx = { change: 0, country: 1, location: 2, name: 3, name_wo_diacritics: 4, subdivision: 5, function: 6, status: 7, date: 8, iata: 9, coordinates: 10, remarks: 11 };
  }
  const get = (r: string[], k: keyof RegistryRow | "change") => (idx[k] == null ? "" : (r[idx[k]!] ?? "").trim());
  const out: RegistryRow[] = [];
  for (const r of rows.slice(start)) {
    const country = get(r, "country").toUpperCase(); const location = get(r, "location").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z2-9]{3}$/.test(location)) continue; // country header lines have no location
    if (countries && !countries.has(country)) continue;
    const change = get(r, "change");
    if (change === "X") continue; // entry marked for removal
    const coords = get(r, "coordinates");
    const { lat, lng } = parseCoordinates(coords);
    out.push({
      code: country + location, country, location, name: get(r, "name") || null, name_wo_diacritics: get(r, "name_wo_diacritics") || get(r, "name") || null,
      subdivision: get(r, "subdivision") || null, function: get(r, "function") || null, status: get(r, "status") || null, date: get(r, "date") || null,
      iata: get(r, "iata") || null, coordinates: coords || null, lat, lng, remarks: get(r, "remarks") || null, release,
    });
  }
  return out;
}

export async function upsertRegistry(sb: SupabaseClient, rows: RegistryRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await sb.from("unlocode_registry").upsert(chunk, { onConflict: "code" });
    if (error) throw new Error(`registry upsert failed at row ${i}: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

/** Countries we trade in: every country code seen in ports + listings (keeps a default import small). */
export async function tradingCountries(sb: SupabaseClient): Promise<Set<string>> {
  const { data } = await sb.from("ports").select("locode");
  const set = new Set<string>();
  for (const p of (data ?? []) as { locode: string }[]) if (p.locode?.length >= 2) set.add(p.locode.slice(0, 2).toUpperCase());
  return set;
}
