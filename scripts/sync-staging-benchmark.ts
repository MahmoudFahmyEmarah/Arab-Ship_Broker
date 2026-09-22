/**
 * Data Sync · large-workbook benchmark (21 Sep 2026). Run:
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local service role key> \
 *   npx tsx scripts/sync-staging-benchmark.ts [rows]
 *
 * DISPOSABLE DATABASE ONLY: this stages real rows. It deletes the batch it
 * created on the way out, and refuses to run against anything that is not a
 * loopback URL unless ALLOW_REMOTE_BENCHMARK=1 is set.
 *
 * WHY IT EXISTS
 *
 * The module publishes a 60,000-row workbook limit. Until now nothing had
 * staged a workbook anywhere near that, so the number was a hope rather than
 * a measurement — and the review asked for either the measurement or a
 * smaller published limit. This produces the measurement:
 *
 *   build    writing the .xlsx with SheetJS
 *   guard    the archive inspection that runs before any XML is parsed
 *   parse    SheetJS read + header mapping, and the grid it actually walked
 *   stage    the real stageBatch: classify, diff, insert, gate
 *
 * It reports rows per second for each phase, so the published limit can be
 * set from evidence, and it says plainly whether the workbook fits inside the
 * worker's 280-second budget.
 */
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { XlsxSource, WORKBOOK_LIMITS } from "@/lib/sync/xlsx-source";
import { assertWorkbookArchiveWithinLimits } from "@/lib/sync/xlsx-guard";
import { stageBatch } from "@/lib/sync/stage";

const ROWS = Number(process.argv[2] ?? 60_000);
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
/** The worker's per-pass budget in /api/cron/upload-jobs. */
const WORKER_BUDGET_MS = 280_000;

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL);
if (!isLocal && process.env.ALLOW_REMOTE_BENCHMARK !== "1") {
  console.error(`refusing to benchmark against ${URL} — this stages real rows. Point SUPABASE_URL at a disposable database.`);
  process.exit(2);
}
if (!KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY is required"); process.exit(2); }

// Date.now() rather than process.hrtime.bigint(): a BigInt literal needs an
// ES2020 target, and these phases are measured in seconds, not microseconds.
const ms = () => Date.now();
const rate = (n: number, t: number) => (t > 0 ? Math.round(n / (t / 1000)) : 0);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function buildWorkbook(rows: number): Buffer {
  const PORTS = ["EGALY", "EGDAM", "TRIZM", "UAODS", "RUNOI", "SAJED", "NLRTM", "CNDLC", "INMAA", "ARSLO"];
  const COMMODITIES = ["Wheat", "Corn", "Barley", "Urea", "Cement clinker", "Soybean meal", "Fertilizer", "Steel coils"];
  const data: Record<string, unknown>[] = [{ REF: "CargoMap benchmark" }];
  for (let i = 0; i < rows; i += 1) {
    data.push({
      REF: `BM-${String(i).padStart(6, "0")}`,
      COMMODITY: COMMODITIES[i % COMMODITIES.length],
      "CARGO TYPE": i % 3 === 0 ? "Break Bulk" : "Dry Bulk",
      "QTY MIN": 5000 + (i % 40) * 100,
      "QTY MAX": 6000 + (i % 40) * 100,
      "LOAD PORT": PORTS[i % PORTS.length],
      "DISCH PORT": PORTS[(i * 7) % PORTS.length],
      "LAYCAN FROM": `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      "LAYCAN TO": `2026-11-${String((i % 28) + 1).padStart(2, "0")}`,
      "FREIGHT IDEA": 20 + (i % 30),
      "COMMISSION": 3.75,
      BROKER: "Benchmark desk",
      NOTES: i % 8 === 0 ? "urgent" : "",
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "01_CARGO");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

async function main() {
  console.log(`Data Sync staging benchmark · ${ROWS.toLocaleString()} rows · ${URL}`);
  console.log(`published workbook limits: ${WORKBOOK_LIMITS.totalRows.toLocaleString()} rows, ${WORKBOOK_LIMITS.totalCells.toLocaleString()} cells\n`);

  let t = ms();
  const buf = buildWorkbook(ROWS);
  const buildMs = ms() - t;
  console.log(`  build    ${String(buildMs).padStart(7)} ms   ${mb(buf.length)}  (${rate(ROWS, buildMs)} rows/s)`);

  t = ms();
  const z = assertWorkbookArchiveWithinLimits(buf);
  const guardMs = ms() - t;
  console.log(`  guard    ${String(guardMs).padStart(7)} ms   ${z.entries.length} parts, unpacks to ${mb(z.totalUncompressed)}`);

  t = ms();
  const source = new XlsxSource(buf);
  const sheets = await source.parse();
  const parseMs = ms() - t;
  const parsedRows = sheets.reduce((a, s) => a + s.rows.length, 0);
  const m = source.lastMeasured;
  console.log(`  parse    ${String(parseMs).padStart(7)} ms   ${parsedRows.toLocaleString()} rows mapped, grid ${m?.rows.toLocaleString()} × ${m?.sheets[0]?.cols} = ${m?.cells.toLocaleString()} cells  (${rate(parsedRows, parseMs)} rows/s)`);

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  let batchId: string | null = null;
  try {
    t = ms();
    const result = await stageBatch({
      supabase: sb,
      source: { kind: "upload", parse: async () => sheets },
      fileName: `benchmark-${ROWS}.xlsx`,
      label: `BENCHMARK-${new Date().toISOString().slice(0, 10)}`,
      budgetMs: WORKER_BUDGET_MS,
    });
    const stageMs = ms() - t;
    batchId = result.batchId;
    console.log(`  stage    ${String(stageMs).padStart(7)} ms   ${result.totals.new} new · ${result.totals.updated} updated · ${result.totals.invalid} blocked  (${rate(parsedRows, stageMs)} rows/s)`);
    if (result.gate) console.log(`           gate: ${result.gate.rules} rule(s), ${result.gate.blocked} blocked, ${result.gate.warned} warned`);

    const total = buildMs + guardMs + parseMs + stageMs;
    const worker = guardMs + parseMs + stageMs; // what the background worker actually does
    console.log(`\n  worker path (guard + parse + stage): ${(worker / 1000).toFixed(1)} s of the ${WORKER_BUDGET_MS / 1000} s budget  (${Math.round((worker / WORKER_BUDGET_MS) * 100)} %)`);
    console.log(`  whole benchmark including building the file: ${(total / 1000).toFixed(1)} s`);
    if (worker > WORKER_BUDGET_MS) {
      console.log(`\n  VERDICT: ${ROWS.toLocaleString()} rows does NOT fit the worker budget. Lower the published limit.`);
      process.exitCode = 1;
    } else {
      const headroom = Math.floor(ROWS * (WORKER_BUDGET_MS / worker));
      console.log(`\n  VERDICT: ${ROWS.toLocaleString()} rows fits, with room for roughly ${headroom.toLocaleString()} at this rate.`);
    }
  } finally {
    if (batchId) {
      await sb.from("sync_staged_row").delete().eq("batch_id", batchId);
      await sb.from("sync_batch").delete().eq("id", batchId);
      console.log(`  cleaned up batch ${batchId}`);
    }
  }
}
void main();
