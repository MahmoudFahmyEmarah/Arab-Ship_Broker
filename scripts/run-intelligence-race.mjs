import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const windowsGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.env.RULES_BASH?.trim()
  || (process.platform === "win32" && existsSync(windowsGitBash) ? windowsGitBash : "bash");
const script = "supabase/tests/rules/intelligence_race_two_sessions.sh";
const result = spawnSync(bash, [script], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`Could not start ${bash}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
