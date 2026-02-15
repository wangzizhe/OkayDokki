import { createDb, initDb } from "../db.js";

const db = createDb();
initDb(db);
process.stdout.write("database initialized\n");

