import type { ValidatedMatchingRulesV1 } from "./types";
import { assertValidatedMatchingRulesV1 } from "./validate";

function compareCodeUnits(left: string, right: string): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const delta = left.charCodeAt(index) - right.charCodeAt(index);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/**
 * A small RFC-8785-compatible subset for the JSON values used by rule
 * documents. It rejects values that JSON.stringify would silently discard or
 * rewrite, and it does not use locale-sensitive ordering.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)!;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value)!;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not support cycles");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Canonical JSON does not support sparse arrays");
        }
        parts.push(serialize(value[index], ancestors));
      }
      const nonIndexKeys = Reflect.ownKeys(value).filter((key) => {
        if (key === "length") return false;
        if (typeof key !== "string") return true;
        const index = Number(key);
        return !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key;
      });
      if (nonIndexKeys.length > 0) throw new TypeError("Canonical JSON arrays cannot have named or symbol properties");
      return `[${parts.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports plain objects only");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical JSON does not support symbol keys");
    }
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
        throw new TypeError("Canonical JSON requires enumerable data properties");
      }
    }
    stringKeys.sort(compareCodeUnits);
    const record = value as Record<string, unknown>;
    return `{${stringKeys.map((key) => `${JSON.stringify(key)!}:${serialize(record[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Canonical persisted v1 document; browser-safe and hash-algorithm neutral. */
export function canonicalMatchingRulesV1(rules: ValidatedMatchingRulesV1): string {
  assertValidatedMatchingRulesV1(rules);
  return canonicalJson(rules);
}
