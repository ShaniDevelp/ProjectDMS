import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { adjustmentLines, items, stockAdjustments, stockBalances, stockTransfers, transferLines } from "@/db/schema";
import { nextNo, SERIES } from "./numbering";
import { allocateFefo, assertBatchUsable, ensureBatch, move, reverseStock } from "./stock";
import { assert, DomainError, r, today, toNum } from "./util";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const optId = z.coerce
  .number()
  .int()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

async function hasBatch(tx: Tx, itemId: number) {
  const [it] = await tx.select({ hasBatch: items.hasBatch }).from(items).where(eq(items.id, itemId));
  if (!it) throw new DomainError(`Item #${itemId} not found`);
  return it.hasBatch;
}

// ───────────────────────── Stock Transfer (godown → van, etc.) ─────────────────────────

export const transferInput = z.object({
  fromWarehouseId: z.coerce.number().int().positive(),
  toWarehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive(),
        /** Empty = pick batches automatically (FEFO). */
        batchId: optId,
        qty: z.coerce.number().int().positive("Qty must be more than 0"),
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createStockTransfer(input: unknown) {
  const v = transferInput.parse(input);
  assert(v.fromWarehouseId !== v.toWarehouseId, "Source and target warehouse must differ");
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(stockTransfers)
      .values({
        no: await nextNo(tx, SERIES.stockTransfer, v.date),
        date: v.date,
        fromWarehouseId: v.fromWarehouseId,
        toWarehouseId: v.toWarehouseId,
        remarks: v.remarks ?? null,
      })
      .returning();
    await tx.insert(transferLines).values(v.lines.map((l) => ({ transferId: t.id, itemId: l.itemId, batchId: l.batchId, qty: l.qty })));
    return t;
  });
}

export async function submitStockTransfer(id: number) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for("update");
    if (!t) throw new DomainError(`Transfer #${id} not found`);
    assert(t.status === "draft", `${t.no} is ${t.status}, only drafts can be submitted`);
    const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, id)).orderBy(transferLines.itemId);
    for (const line of lines) {
      const batched = await hasBatch(tx, line.itemId);
      let picks: { batchId: number | null; qty: number }[];
      if (!batched) picks = [{ batchId: null, qty: line.qty }];
      else if (line.batchId) picks = [{ batchId: line.batchId, qty: line.qty }];
      else picks = await allocateFefo(tx, { itemId: line.itemId, warehouseId: t.fromWarehouseId, qty: line.qty, onDate: t.date });
      for (const p of picks) {
        const out = await move(tx, {
          itemId: line.itemId,
          warehouseId: t.fromWarehouseId,
          batchId: p.batchId,
          qty: -p.qty,
          voucherType: "stock_transfer",
          voucherId: id,
          voucherLineId: line.id,
        });
        // Same value comes in that went out: transfers never change total stock value.
        await move(tx, {
          itemId: line.itemId,
          warehouseId: t.toWarehouseId,
          batchId: p.batchId,
          qty: p.qty,
          value: -out.valueChange,
          voucherType: "stock_transfer",
          voucherId: id,
          voucherLineId: line.id,
        });
      }
    }
    await tx.update(stockTransfers).set({ status: "submitted", submittedAt: new Date() }).where(eq(stockTransfers.id, id));
  });
}

export async function cancelStockTransfer(id: number) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for("update");
    if (!t) throw new DomainError(`Transfer #${id} not found`);
    assert(t.status === "submitted", `${t.no} is ${t.status}`);
    await reverseStock(tx, "stock_transfer", id);
    await tx.update(stockTransfers).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(stockTransfers.id, id));
  });
}

// ───────────────────────── Stock Adjustment (count, damage, expiry, opening) ─────────────────────────

export const adjustmentInput = z.object({
  warehouseId: z.coerce.number().int().positive(),
  reason: z.enum(["count", "damage", "expiry", "opening", "other"]).default("count"),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive(),
        batchId: optId,
        batchNo: z.string().optional().nullable(),
        expiryDate: isoDate.optional().nullable().or(z.literal("").transform(() => null)),
        qtyChange: z.coerce
          .number()
          .int()
          .refine((n) => n !== 0, "Qty change cannot be 0"),
        /** Per-piece rate for stock added; 0 = use current valuation (or item buy rate). */
        rate: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createStockAdjustment(input: unknown) {
  const v = adjustmentInput.parse(input);
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(stockAdjustments)
      .values({
        no: await nextNo(tx, SERIES.stockAdjustment, v.date),
        date: v.date,
        warehouseId: v.warehouseId,
        reason: v.reason,
        remarks: v.remarks ?? null,
      })
      .returning();
    await tx.insert(adjustmentLines).values(
      v.lines.map((l) => ({
        adjustmentId: a.id,
        itemId: l.itemId,
        batchId: l.batchId,
        batchNo: l.batchNo?.trim() || null,
        expiryDate: l.expiryDate || null,
        qtyChange: l.qtyChange,
        rate: r(l.rate),
      })),
    );
    return a;
  });
}

export async function submitStockAdjustment(id: number) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update");
    if (!a) throw new DomainError(`Adjustment #${id} not found`);
    assert(a.status === "draft", `${a.no} is ${a.status}, only drafts can be submitted`);
    const lines = await tx.select().from(adjustmentLines).where(eq(adjustmentLines.adjustmentId, id)).orderBy(adjustmentLines.itemId);
    for (const line of lines) {
      const batched = await hasBatch(tx, line.itemId);
      const base = { itemId: line.itemId, warehouseId: a.warehouseId, voucherType: "stock_adjustment", voucherId: id, voucherLineId: line.id };
      if (line.qtyChange > 0) {
        let batchId: number | null = null;
        if (batched) {
          batchId = line.batchId ?? (await ensureBatch(tx, line.itemId, line.batchNo ?? "", line.expiryDate));
          await tx.update(adjustmentLines).set({ batchId }).where(eq(adjustmentLines.id, line.id));
        }
        let rate = toNum(line.rate);
        if (rate === 0) {
          const [bal] = await tx
            .select()
            .from(stockBalances)
            .where(and(eq(stockBalances.itemId, line.itemId), eq(stockBalances.warehouseId, a.warehouseId)));
          rate = toNum(bal?.valuationRate);
          if (rate === 0) {
            const [it] = await tx.select({ buyRate: items.buyRate }).from(items).where(eq(items.id, line.itemId));
            rate = toNum(it?.buyRate);
          }
        }
        await move(tx, { ...base, batchId, qty: line.qtyChange, rate });
      } else {
        const out = -line.qtyChange;
        // Write-offs may take expired stock; that is usually the point.
        const allowExpired = a.reason === "expiry" || a.reason === "damage" || a.reason === "count";
        let picks: { batchId: number | null; qty: number }[];
        if (!batched) picks = [{ batchId: null, qty: out }];
        else if (line.batchId) {
          if (!allowExpired) await assertBatchUsable(tx, line.batchId, a.date);
          picks = [{ batchId: line.batchId, qty: out }];
        } else picks = await allocateFefo(tx, { itemId: line.itemId, warehouseId: a.warehouseId, qty: out, onDate: a.date, includeExpired: allowExpired });
        for (const p of picks) await move(tx, { ...base, batchId: p.batchId, qty: -p.qty });
      }
    }
    await tx.update(stockAdjustments).set({ status: "submitted", submittedAt: new Date() }).where(eq(stockAdjustments.id, id));
  });
}

export async function cancelStockAdjustment(id: number) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update");
    if (!a) throw new DomainError(`Adjustment #${id} not found`);
    assert(a.status === "submitted", `${a.no} is ${a.status}`);
    await reverseStock(tx, "stock_adjustment", id);
    await tx.update(stockAdjustments).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(stockAdjustments.id, id));
  });
}
