#!/usr/bin/env node
/**
 * Build a review-only source inventory for the PDA tariff intake process.
 *
 * Usage:
 *   node scripts/port-tariff-inventory.mjs "D:/.../Port Tarifs" > sources.json
 *
 * The output deliberately contains no extracted tariff rules. It is an
 * evidence manifest for an owner/admin to review and register through the
 * Port Tariffs screen before an independently reviewed staging operation.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  console.error('Usage: node scripts/port-tariff-inventory.mjs "<source-directory>"');
  process.exit(2);
}

const MIME_BY_EXTENSION = Object.freeze({
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".zip": "application/zip",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
});

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const root = resolve(sourceDirectory);
const files = await collect(root);
const sources = await Promise.all(files.map(async (path) => {
  const extension = extname(path).toLowerCase();
  const bytes = await readFile(path);
  const metadata = await stat(path);
  return {
    title: basename(path, extension).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    sourceFilename: basename(path),
    mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: metadata.size,
    authority: "unverified",
    storagePath: null,
    sourceUri: null,
    language: null,
    issueDate: null,
    effectiveFrom: null,
    effectiveTo: null,
    currentnessNote: "Generated inventory; verify issuer, coverage and effective dates before staging.",
  };
}));

process.stdout.write(JSON.stringify({
  schemaVersion: "asb.pda.tariff-source-inventory.v1",
  generatedAt: new Date().toISOString(),
  sourceRoot: root,
  sourceCount: sources.length,
  sources,
}, null, 2) + "\n");
