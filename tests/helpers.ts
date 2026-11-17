import { sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { saveCustomer, saveItem, saveSalesperson, saveSupplier, saveWarehouse } from "@/server/masters";

export async function resetDb() {
  const res = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`,
  );
  const names = res.rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

export async function closeDb() {
  await pool.end();
}

export async function seedBasics() {
  const godown = await saveWarehouse({ name: "Main Godown", kind: "godown" });
  const van = await saveWarehouse({ name: "Van-1", kind: "van" });
  const supplier = await saveSupplier({ name: "ABC Foods" });
  const ali = await saveSalesperson({ name: "Ali" });
  const tea = await saveItem({ code: "TEA950", name: "Tea 950g", pcsPerCarton: 12, buyRate: 900, sellRate: 1000 });
  const oil = await saveItem({ code: "OIL5L", name: "Cooking Oil 5L", pcsPerCarton: 4, hasBatch: true, buyRate: 2500, sellRate: 2800 });
  const shop = await saveCustomer({ name: "Bilal Store", salespersonId: ali.id, creditLimit: 100000, creditDays: 15 });
  return { godown, van, supplier, ali, tea, oil, shop };
}
