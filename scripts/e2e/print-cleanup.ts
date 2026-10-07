// prints cleanupSql for the proof ids (args: comma-separated users; the rest fixed)
import { cleanupSql } from "../../e2e/fixture-room.helpers";
const users = (process.argv[2] ?? "").split(",").filter(Boolean);
process.stdout.write(cleanupSql({
  userIds: users,
  orgIds: ["00000000-0000-4000-8000-00000000e0c1", "00000000-0000-4000-8000-00000000e0c2"],
  cargoIds: ["00000000-0000-4000-8000-00000000e0e1"],
  availabilityIds: ["00000000-0000-4000-8000-00000000e0b1"],
  vesselIds: ["00000000-0000-4000-8000-00000000e0f1"],
}));
