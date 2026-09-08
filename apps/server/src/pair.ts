import { database, migrate } from "./persistence.js";
import { createPairingCode } from "./auth.js";
const db = database(process.env.DATABASE_URL!);
try {
  await migrate(db);
  console.log(
    await createPairingCode(
      db,
      process.argv.includes("--agent") ? "agent" : "device",
    ),
  );
} finally {
  await db.end();
}
