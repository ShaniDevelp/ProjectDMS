import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, items, salespersons, suppliers, territories, warehouses } from "@/db/schema";
import { DomainError, m, r } from "./util";

const optText = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optId = z.coerce
  .number()
  .int()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const itemInput = z.object({
  code: z.string().trim().min(1, "Code is required"),
  name: z.string().trim().min(1, "Name is required"),
  pcsPerCarton: z.coerce.number().int().min(1).default(1),
  hasBatch: z.coerce.boolean().default(false),
  buyRate: z.coerce.number().min(0).default(0),
  sellRate: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().int().min(0).default(0),
  active: z.coerce.boolean().default(true),
});

export async function saveItem(input: unknown, id?: number) {
  const v = itemInput.parse(input);
  const row = { ...v, buyRate: r(v.buyRate), sellRate: r(v.sellRate) };
  if (id) return (await db.update(items).set(row).where(eq(items.id, id)).returning())[0];
  return (await db.insert(items).values(row).returning())[0];
}

export const warehouseInput = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["godown", "van"]).default("godown"),
  active: z.coerce.boolean().default(true),
});

export async function saveWarehouse(input: unknown, id?: number) {
  const v = warehouseInput.parse(input);
  if (id) return (await db.update(warehouses).set(v).where(eq(warehouses.id, id)).returning())[0];
  return (await db.insert(warehouses).values(v).returning())[0];
}

export const supplierInput = z.object({
  name: z.string().trim().min(1),
  phone: optText,
  address: optText,
});

export async function saveSupplier(input: unknown, id?: number) {
  const v = supplierInput.parse(input);
  if (id) return (await db.update(suppliers).set(v).where(eq(suppliers.id, id)).returning())[0];
  return (await db.insert(suppliers).values(v).returning())[0];
}

export const territoryInput = z.object({ name: z.string().trim().min(1), parentId: optId });

export async function saveTerritory(input: unknown, id?: number) {
  const v = territoryInput.parse(input);
  if (id) return (await db.update(territories).set(v).where(eq(territories.id, id)).returning())[0];
  return (await db.insert(territories).values(v).returning())[0];
}

export const salespersonInput = z.object({
  name: z.string().trim().min(1),
  phone: optText,
  active: z.coerce.boolean().default(true),
});

export async function saveSalesperson(input: unknown, id?: number) {
  const v = salespersonInput.parse(input);
  if (id) return (await db.update(salespersons).set(v).where(eq(salespersons.id, id)).returning())[0];
  return (await db.insert(salespersons).values(v).returning())[0];
}

export const customerInput = z.object({
  name: z.string().trim().min(1),
  ownerName: optText,
  phone: optText,
  address: optText,
  territoryId: optId,
  salespersonId: optId,
  /** Empty = unlimited. */
  creditLimit: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().min(0)])
    .transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  creditDays: z.coerce.number().int().min(0).default(0),
  creditOverride: z.coerce.boolean().default(false),
  blocked: z.coerce.boolean().default(false),
});

export async function saveCustomer(input: unknown, id?: number) {
  const v = customerInput.parse(input);
  const row = { ...v, creditLimit: v.creditLimit === null ? null : m(v.creditLimit) };
  if (id) return (await db.update(customers).set(row).where(eq(customers.id, id)).returning())[0];
  return (await db.insert(customers).values(row).returning())[0];
}

export async function listMasters() {
  const [it, wh, sup, ter, sp, cu] = await Promise.all([
    db.select().from(items).orderBy(asc(items.name)),
    db.select().from(warehouses).orderBy(asc(warehouses.name)),
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select().from(territories).orderBy(asc(territories.name)),
    db.select().from(salespersons).orderBy(asc(salespersons.name)),
    db.select().from(customers).orderBy(asc(customers.name)),
  ]);
  return { items: it, warehouses: wh, suppliers: sup, territories: ter, salespersons: sp, customers: cu };
}

const MASTER_TABLES = { customers, items, suppliers, warehouses, salespersons, territories } as const;

/** What to suggest instead of deleting a record that is already in use. */
const IN_USE_HINT: Record<keyof typeof MASTER_TABLES, string> = {
  customers: "Tick “Blocked” on the customer instead.",
  items: "Untick “Active” on the item instead.",
  suppliers: "Keep it; it no longer needs to be used.",
  warehouses: "Untick “Active” on the warehouse instead.",
  salespersons: "Untick “Active” on the salesperson instead.",
  territories: "Move its shops to another area first.",
};

/**
 * Delete a master record. Records used by any document, ledger row or other master are
 * protected by foreign keys, so history can never point at a missing customer/item.
 */
export async function deleteMaster(kind: keyof typeof MASTER_TABLES, id: number) {
  const t = MASTER_TABLES[kind];
  if (kind === "territories") {
    const children = await db.select({ id: territories.id }).from(territories).where(eq(territories.parentId, id)).limit(1);
    if (children.length) throw new DomainError("This area has sub-areas. Delete or move them first.");
  }
  try {
    const res = await db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
    if (!res.length) throw new DomainError("Record not found. It may already be deleted.");
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
    if (code === "23503") throw new DomainError(`It is already used in documents or other records, so it can’t be deleted. ${IN_USE_HINT[kind]}`);
    throw e;
  }
}
