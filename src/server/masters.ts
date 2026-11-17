import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, items, salespersons, suppliers, territories, warehouses } from "@/db/schema";
import { m, r } from "./util";

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
