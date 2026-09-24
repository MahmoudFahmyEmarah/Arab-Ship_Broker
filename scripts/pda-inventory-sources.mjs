import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "Port Tarifs");
const allowed = new Set([".pdf", ".xlsx", ".xls", ".csv", ".docx"]);

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (allowed.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }
  return result;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const inventory = [];
for (const file of await files(root)) {
  const info = await stat(file);
  inventory.push({
    relativePath: path.relative(root, file).replaceAll(path.sep, "/"),
    extension: path.extname(file).slice(1).toLowerCase(),
    bytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    sha256: await sha256(file),
    status: "unverified",
  });
}

const byHash = new Map();
for (const item of inventory) byHash.set(item.sha256, [...(byHash.get(item.sha256) ?? []), item]);
const duplicateGroups = [...byHash.entries()]
  .filter(([, group]) => group.length > 1)
  .map(([sha256, group]) => ({ sha256, files: group.map((item) => item.relativePath) }));

const report = { root, generatedAt: new Date().toISOString(), count: inventory.length, duplicateGroups, files: inventory };
if (process.argv.includes("--summary")) {
  const extensions = {};
  for (const item of inventory) extensions[item.extension] = (extensions[item.extension] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({ root, count: inventory.length, extensions, duplicateGroups }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
