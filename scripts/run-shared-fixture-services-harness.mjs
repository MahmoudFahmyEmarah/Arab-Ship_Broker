import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = process.platform === "win32"
  ? [process.env.GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe"].filter(Boolean)
  : [process.env.BASH_PATH, "/usr/bin/bash", "/bin/bash", "bash"].filter(Boolean);
const bash = candidates.find((candidate) => candidate === "bash" || existsSync(candidate));
if (!bash) {
  console.error("Git Bash (Windows) or bash is required for the disposable SQL harness.");
  process.exit(2);
}

const result = spawnSync(bash, ["scripts/shared-fixture-services-harness.sh"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
