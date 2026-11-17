import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { batchBalances, batches, items, stockBalances, stockLedger, warehouses } from "@/db/schema";
import { DomainError, m, r, round2, round4, toNum } from "./util";

export type VoucherRef = { voucherType: string; voucherId: number; voucherLineId?: number | null };

export type Movement = VoucherRef & {
  itemId: number;
  warehouseId: number;
  batchId?: number | null;
  /** Signed pieces. */
  qty: number;
  /** Inward only: incoming rate per piece. Ignored when `value` is given. */
  rate?: number;
  /** Explicit value change (used by reversals and transfers). Sign must match qty. */
  value?: number;
  reversesId?: number | null;
};

export type PostedMovement = { ledgerId: number; costRate: number; valueChange: number };

async function itemLabel(tx: Tx, itemId: number) {
  const [it] = await tx.select({ code: items.code, name: items.name }).from(items).where(eq(items.id, itemId));
  return it ? `${it.code} ${it.name}` : `item #${itemId}`;
}

async function whLabel(tx: Tx, warehouseId: number) {
  const [w] = await tx.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, warehouseId));
  return w?.name ?? `warehouse #${warehouseId}`;
}

/** Lock (creating if needed) the item × warehouse balance row. */
async function lockBalance(tx: Tx, itemId: number, warehouseId: number) {
  await tx.insert(stockBalances).values({ itemId, warehouseId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.warehouseId, warehouseId)))
    .for("update");
  return { qty: row.qty, value: toNum(row.value), rate: toNum(row.valuationRate) };
}

async function lockBatchBalance(tx: Tx, itemId: number, warehouseId: number, batchId: number) {
  await tx.insert(batchBalances).values({ itemId, warehouseId, batchId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(batchBalances)
    .where(
      and(eq(batchBalances.itemId, itemId), eq(batchBalances.warehouseId, warehouseId), eq(batchBalances.batchId, batchId)),
    )
    .for("update");
  return row.qty;
}

/**
 * Post one stock movement: append a ledger row and update the cached balances.
 * Moving-average valuation. Negative stock is never allowed.
 */
export async function move(tx: Tx, mv: Movement): Promise<PostedMovement> {
  if (!Number.isInteger(mv.qty) || mv.qty === 0) throw new DomainError("Stock movement qty must be a non-zero whole number");
  const bal = await lockBalance(tx, mv.itemId, mv.warehouseId);
  const newQty = bal.qty + mv.qty;

  if (newQty < 0) {
    throw new DomainError(
      `Not enough stock of ${await itemLabel(tx, mv.itemId)} in ${await whLabel(tx, mv.warehouseId)}: have ${bal.qty}, need ${-mv.qty}`,
    );
  }

  let valueChange: number;
  if (mv.value !== undefined) {
    valueChange = round2(mv.value);
  } else if (mv.qty > 0) {
    valueChange = round2(mv.qty * (mv.rate ?? 0));
  } else {
    valueChange = round2(mv.qty * bal.rate);
  }
  // Emptying the bin takes out exactly what is left, so no rounding residue stays behind.
  if (newQty === 0) valueChange = round2(-bal.value);

  const newValue = round2(bal.value + valueChange);
  const newRate = newQty > 0 ? round4(newValue / newQty) : mv.qty > 0 ? round4(valueChange / mv.qty) : bal.rate;
  const rowRate = round4(Math.abs(valueChange) / Math.abs(mv.qty));

  if (mv.batchId) {
    const bq = await lockBatchBalance(tx, mv.itemId, mv.warehouseId, mv.batchId);
    if (bq + mv.qty < 0) {
      const [b] = await tx.select({ no: batches.batchNo }).from(batches).where(eq(batches.id, mv.batchId));
      throw new DomainError(`Not enough stock in batch ${b?.no ?? mv.batchId}: have ${bq}, need ${-mv.qty}`);
    }
    await tx
      .update(batchBalances)
      .set({ qty: bq + mv.qty })
      .where(
        and(
          eq(batchBalances.itemId, mv.itemId),
          eq(batchBalances.warehouseId, mv.warehouseId),
          eq(batchBalances.batchId, mv.batchId),
        ),
      );
  }

  await tx
    .update(stockBalances)
    .set({ qty: newQty, value: m(newValue), valuationRate: r(newRate) })
    .where(and(eq(stockBalances.itemId, mv.itemId), eq(stockBalances.warehouseId, mv.warehouseId)));

  const [row] = await tx
    .insert(stockLedger)
    .values({
      itemId: mv.itemId,
      warehouseId: mv.warehouseId,
      batchId: mv.batchId ?? null,
      qty: mv.qty,
      rate: r(rowRate),
      valueChange: m(valueChange),
      qtyAfter: newQty,
      valuationRateAfter: r(newRate),
      voucherType: mv.voucherType,
      voucherId: mv.voucherId,
      voucherLineId: mv.voucherLineId ?? null,
      reversesId: mv.reversesId ?? null,
    })
    .returning({ id: stockLedger.id });

  return { ledgerId: row.id, costRate: rowRate, valueChange };
}

/**
 * Cancel a voucher's stock effect by appending mirror rows (newest first).
 * Original rows are never edited, so the ledger stays a full audit trail.
 */
export async function reverseStock(tx: Tx, voucherType: string, voucherId: number) {
  const rows = await tx
    .select()
    .from(stockLedger)
    .where(and(eq(stockLedger.voucherType, voucherType), eq(stockLedger.voucherId, voucherId), isNull(stockLedger.reversesId)))
    .orderBy(desc(stockLedger.id));
  // Reverse inward rows last-in-first so a cancelled receipt fails cleanly if the stock was already sold.
  for (const row of rows) {
    await move(tx, {
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      batchId: row.batchId,
      qty: -row.qty,
      value: -toNum(row.valueChange),
      voucherType,
      voucherId,
      voucherLineId: row.voucherLineId,
      reversesId: row.id,
    });
  }
}

export async function ensureBatch(tx: Tx, itemId: number, batchNo: string, expiryDate: string | null | undefined) {
  const no = batchNo.trim();
  if (!no) throw new DomainError("Batch number is required for batch-tracked items");
  const [existing] = await tx
    .select()
    .from(batches)
    .where(and(eq(batches.itemId, itemId), eq(batches.batchNo, no)));
  if (existing) {
    if (expiryDate && existing.expiryDate && existing.expiryDate !== expiryDate) {
      throw new DomainError(`Batch ${no} already exists with expiry ${existing.expiryDate}`);
    }
    if (expiryDate && !existing.expiryDate) {
      await tx.update(batches).set({ expiryDate }).where(eq(batches.id, existing.id));
    }
    return existing.id;
  }
  const [b] = await tx.insert(batches).values({ itemId, batchNo: no, expiryDate: expiryDate || null }).returning();
  return b.id;
}

export type BatchPick = { batchId: number; qty: number };

/**
 * First-expiry-first-out allocation. Expired batches are skipped unless
 * `includeExpired` (write-offs of expired stock).
 */
export async function allocateFefo(
  tx: Tx,
  opts: { itemId: number; warehouseId: number; qty: number; onDate: string; includeExpired?: boolean },
): Promise<BatchPick[]> {
  const rows = await tx
    .select({ batchId: batchBalances.batchId, qty: batchBalances.qty, expiry: batches.expiryDate })
    .from(batchBalances)
    .innerJoin(batches, eq(batches.id, batchBalances.batchId))
    .where(
      and(
        eq(batchBalances.itemId, opts.itemId),
        eq(batchBalances.warehouseId, opts.warehouseId),
        sql`${batchBalances.qty} > 0`,
        opts.includeExpired ? sql`true` : sql`(${batches.expiryDate} IS NULL OR ${batches.expiryDate} >= ${opts.onDate})`,
      ),
    )
    .orderBy(sql`${batches.expiryDate} ASC NULLS LAST`, asc(batches.id));

  const picks: BatchPick[] = [];
  let need = opts.qty;
  for (const row of rows) {
    if (need <= 0) break;
    const take = Math.min(row.qty, need);
    picks.push({ batchId: row.batchId, qty: take });
    need -= take;
  }
  if (need > 0) {
    const have = opts.qty - need;
    throw new DomainError(
      `Not enough ${opts.includeExpired ? "" : "non-expired "}stock of ${await itemLabel(tx, opts.itemId)} in ${await whLabel(
        tx,
        opts.warehouseId,
      )}: have ${have}, need ${opts.qty}`,
    );
  }
  return picks;
}

export async function assertBatchUsable(tx: Tx, batchId: number, onDate: string) {
  const [b] = await tx.select().from(batches).where(eq(batches.id, batchId));
  if (!b) throw new DomainError(`Batch #${batchId} not found`);
  if (b.expiryDate && b.expiryDate < onDate) throw new DomainError(`Batch ${b.batchNo} expired on ${b.expiryDate}`);
  return b;
}
