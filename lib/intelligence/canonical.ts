import type { ValidatedIntelligenceRuleSet } from "./types";
import { assertValidatedIntelligenceRuleSet } from "./trust";

export function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
  if (Object.is(value, -0) || value === 0) return "0";
  const rendered = String(value);
  if (!/[eE]/.test(rendered)) return rendered;

  // Rule thresholds are range-bounded and modest, but keep this serializer
  // deterministic for valid scientific notation as well.
  const [coefficient, rawExponent] = rendered.toLowerCase().split("e");
  const exponent = Number(rawExponent);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [integer, fraction = ""] = unsigned.split(".");
  const digits = integer + fraction;
  const point = integer.length + exponent;
  let expanded: string;
  if (point <= 0) expanded = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) expanded = `${digits}${"0".repeat(point - digits.length)}`;
  else expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  expanded = expanded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return negative ? `-${expanded}` : expanded;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError("Canonical JSON rejects sparse or decorated arrays");
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError("Canonical JSON rejects sparse arrays");
      }
    }
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort(compareAscii);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalIntelligenceRuleSet(ruleSet: ValidatedIntelligenceRuleSet): string {
  assertValidatedIntelligenceRuleSet(ruleSet);
  return canonicalJson(ruleSet);
}

export async function hashIntelligenceRuleSet(ruleSet: ValidatedIntelligenceRuleSet): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  const bytes = new TextEncoder().encode(canonicalIntelligenceRuleSet(ruleSet));
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
