// prints cleanupSql for the proof ids. args: <mode> <comma-separated user ids> [all|users]
import { cleanupSql, type CleanupMode } from "../../e2e/e2e-cleanup";
const mode = (process.argv[2] ?? "teardown") as CleanupMode;
const users = (process.argv[3] ?? "").split(",").filter(Boolean);
const scope = process.argv[4] ?? "all";
const ports = (process.env.PROOF_PORTS ?? "").split(",").filter(Boolean);
process.stdout.write(cleanupSql(scope === "users" ? { userIds: users } : {
  userIds: users,
  orgIds: ["00000000-0000-4000-8000-00000000e0c1", "00000000-0000-4000-8000-00000000e0c2"],
  cargoIds: ["00000000-0000-4000-8000-00000000e0e1"],
  availabilityIds: ["00000000-0000-4000-8000-00000000e0b1"],
  vesselIds: ["00000000-0000-4000-8000-00000000e0f1"],
  ...(ports.length ? { portCodes: ports, portStamp: "proofstamp01" } : {}),
}, mode));
