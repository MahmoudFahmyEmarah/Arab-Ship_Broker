import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const script = readFileSync(resolve(process.cwd(), "scripts/port-tariff-inventory.mjs"), "utf8");
assert.match(script, /createHash\("sha256"\)/);
assert.match(script, /authority: "unverified"/);
assert.match(script, /sourceFilename/);
assert.match(script, /mimeType/);
assert.match(script, /no extracted tariff rules/i);
console.log("port-tariff-inventory-check: PASS");
