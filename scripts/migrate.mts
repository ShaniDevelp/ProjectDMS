import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.argv[2] === "--test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrated", url?.replace(/:[^:@/]+@/, ":***@"));
