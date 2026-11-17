import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import {
  billLines,
  grnLines,
  grns,
  items,
  poLines,
  purchaseBills,
  purchaseOrders,
  supplierPaymentAllocations,
  supplierPayments,
} from "@/db/schema";
import { autoAllocate, checkAllocations, openDocs } from "./allocation";
import { nextNo, SERIES } from "./numbering";
import { outstanding, postParty, reverseParty } from "./party";
import { ensureBatch, move, reverseStock } from "./stock";
import { assert, DomainError, m, r, round2, today, toNum } from "./util";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const qty = z.coerce.number().int("Qty must be whole pieces").positive("Qty must be more than 0");
const money = z.coerce.number().min(0);

// ───────────────────────── Purchase Order ─────────────────────────

export const poInput = z.object({
  supplierId: z.coerce.number().int().positive(),
  warehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  lines: z.array(z.object({ itemId: z.coerce.number().int().positive(), qty, rate: money })).min(1, "Add at least one item"),
});

export async function createPurchaseOrder(input: unknown) {
  const v = poInput.parse(input);
  return db.transaction(async (tx) => {
    const lines = v.lines.map((l) => ({ ...l, amount: round2(l.qty * l.rate) }));
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        no: await nextNo(tx, SERIES.purchaseOrder, v.date),
        date: v.date,
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx.insert(poLines).values(lines.map((l) => ({ poId: po.id, itemId: l.itemId, qty: l.qty, rate: r(l.rate), amount: m(l.amount) })));
    return po;
  });
}

async function lockPo(tx: Tx, id: number) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
  if (!po) throw new DomainError(`Purchase order #${id} not found`);
  return po;
}

export async function submitPurchaseOrder(id: number) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    assert(po.status === "draft", `${po.no} is ${po.status}, only drafts can be submitted`);
    await tx.update(purchaseOrders).set({ status: "submitted", submittedAt: new Date() }).where(eq(purchaseOrders.id, id));
  });
}

export async function cancelPurchaseOrder(id: number) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    assert(po.status === "submitted", `${po.no} is ${po.status}`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(grns)
      .where(and(eq(grns.poId, id), eq(grns.status, "submitted")));
    assert(n === 0, `${po.no} has goods receipts. Cancel them first.`);
    await tx.update(purchaseOrders).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(purchaseOrders.id, id));
  });
}

/** Close a short-received PO so its pending qty stops counting as "on order". */
export async function setPurchaseOrderClosed(id: number, closed: boolean) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    assert(po.status === "submitted", `${po.no} is ${po.status}`);
    await tx.update(purchaseOrders).set({ closed }).where(eq(purchaseOrders.id, id));
  });
}

async function recomputeReceived(tx: Tx, poLineIds: number[]) {
  if (!poLineIds.length) return;
  await tx.execute(sql`
    UPDATE po_lines pl SET received_qty = coalesce((
      SELECT sum(gl.qty) FROM grn_lines gl JOIN grns g ON g.id = gl.grn_id
      WHERE gl.po_line_id = pl.id AND g.status = 'submitted'), 0)
    WHERE pl.id IN ${sql.raw(`(${poLineIds.join(",")})`)}`);
}

// ───────────────────────── Goods Receipt (GRN) ─────────────────────────

export const grnInput = z.object({
  supplierId: z.coerce.number().int().positive(),
  poId: z.coerce.number().int().positive().optional().nullable(),
  warehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  supplierRef: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        poLineId: z.coerce.number().int().positive().optional().nullable(),
        itemId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().min(0),
        rejectedQty: z.coerce.number().int().min(0).default(0),
        rate: money,
        batchNo: z.string().optional().nullable(),
        expiryDate: isoDate.optional().nullable().or(z.literal("").transform(() => null)),
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createGrn(input: unknown) {
  const v = grnInput.parse(input);
  return db.transaction(async (tx) => {
    const lines = v.lines.filter((l) => l.qty > 0 || l.rejectedQty > 0);
    assert(lines.length > 0, "Enter a received or rejected qty on at least one line");
    if (v.poId) {
      const po = await lockPo(tx, v.poId);
      assert(po.status === "submitted" && !po.closed, `${po.no} is not open for receiving`);
      assert(po.supplierId === v.supplierId, `${po.no} belongs to another supplier`);
      const ids = lines.map((l) => l.poLineId).filter((x): x is number => !!x);
      const pls = ids.length ? await tx.select().from(poLines).where(inArray(poLines.id, ids)) : [];
      for (const l of lines) {
        if (!l.poLineId) continue;
        const pl = pls.find((p) => p.id === l.poLineId);
        assert(pl && pl.poId === v.poId && pl.itemId === l.itemId, "GRN line does not match the purchase order");
      }
    }
    const rows = lines.map((l) => ({ ...l, amount: round2(l.qty * l.rate) }));
    const total = round2(rows.reduce((s, l) => s + l.amount, 0));
    const [g] = await tx
      .insert(grns)
      .values({
        no: await nextNo(tx, SERIES.grn, v.date),
        date: v.date,
        supplierId: v.supplierId,
        poId: v.poId ?? null,
        warehouseId: v.warehouseId,
        supplierRef: v.supplierRef ?? null,
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx.insert(grnLines).values(
      rows.map((l) => ({
        grnId: g.id,
        poLineId: l.poLineId ?? null,
        itemId: l.itemId,
        qty: l.qty,
        rejectedQty: l.rejectedQty,
        rate: r(l.rate),
        amount: m(l.amount),
        batchNo: l.batchNo?.trim() || null,
        expiryDate: l.expiryDate || null,
      })),
    );
    return g;
  });
}

async function lockGrn(tx: Tx, id: number) {
  const [g] = await tx.select().from(grns).where(eq(grns.id, id)).for("update");
  if (!g) throw new DomainError(`Goods receipt #${id} not found`);
  return g;
}

export async function submitGrn(id: number) {
  return db.transaction(async (tx) => {
    const g = await lockGrn(tx, id);
    assert(g.status === "draft", `${g.no} is ${g.status}, only drafts can be submitted`);
    if (g.poId) {
      const po = await lockPo(tx, g.poId);
      assert(po.status === "submitted" && !po.closed, `${po.no} is not open for receiving`);
    }
    const lines = await tx
      .select({ line: grnLines, hasBatch: items.hasBatch })
      .from(grnLines)
      .innerJoin(items, eq(items.id, grnLines.itemId))
      .where(eq(grnLines.grnId, id))
      .orderBy(grnLines.itemId);
    for (const { line, hasBatch } of lines) {
      if (line.qty === 0) continue;
      let batchId: number | null = null;
      if (hasBatch) {
        batchId = await ensureBatch(tx, line.itemId, line.batchNo ?? "", line.expiryDate);
        await tx.update(grnLines).set({ batchId }).where(eq(grnLines.id, line.id));
      }
      await move(tx, {
        itemId: line.itemId,
        warehouseId: g.warehouseId,
        batchId,
        qty: line.qty,
        rate: toNum(line.rate),
        voucherType: "grn",
        voucherId: id,
        voucherLineId: line.id,
      });
    }
    // Flip status first: the recompute sums *submitted* GRN lines, including this one.
    await tx.update(grns).set({ status: "submitted", submittedAt: new Date() }).where(eq(grns.id, id));
    const poLineIds = lines.map((l) => l.line.poLineId).filter((x): x is number => !!x);
    await recomputeReceived(tx, poLineIds);
    if (poLineIds.length) {
      const over = await tx.select().from(poLines).where(and(inArray(poLines.id, poLineIds), sql`${poLines.receivedQty} > ${poLines.qty}`));
      assert(over.length === 0, "Received qty is more than ordered qty on the purchase order");
    }
  });
}

export async function cancelGrn(id: number) {
  return db.transaction(async (tx) => {
    const g = await lockGrn(tx, id);
    assert(g.status === "submitted", `${g.no} is ${g.status}`);
    const lines = await tx.select().from(grnLines).where(eq(grnLines.grnId, id));
    assert(!lines.some((l) => l.billedQty > 0), `${g.no} has purchase bills. Cancel them first.`);
    await reverseStock(tx, "grn", id);
    await tx.update(grns).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(grns.id, id));
    await recomputeReceived(
      tx,
      lines.map((l) => l.poLineId).filter((x): x is number => !!x),
    );
  });
}

// ───────────────────────── Purchase Bill ─────────────────────────

export const billInput = z.object({
  supplierId: z.coerce.number().int().positive(),
  grnId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  dueDate: isoDate.optional().nullable().or(z.literal("").transform(() => null)),
  supplierBillNo: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(z.object({ grnLineId: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(0), rate: money }))
    .min(1),
});

export async function createPurchaseBill(input: unknown) {
  const v = billInput.parse(input);
  return db.transaction(async (tx) => {
    const g = await lockGrn(tx, v.grnId);
    assert(g.status === "submitted", `${g.no} must be submitted before billing`);
    assert(g.supplierId === v.supplierId, `${g.no} belongs to another supplier`);
    const gls = await tx.select().from(grnLines).where(eq(grnLines.grnId, v.grnId));
    const lines = v.lines
      .filter((l) => l.qty > 0)
      .map((l) => {
        const gl = gls.find((x) => x.id === l.grnLineId);
        assert(gl, "Bill line does not match the goods receipt");
        return { ...l, itemId: gl.itemId, amount: round2(l.qty * l.rate) };
      });
    assert(lines.length > 0, "Enter a qty on at least one line");
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const [b] = await tx
      .insert(purchaseBills)
      .values({
        no: await nextNo(tx, SERIES.purchaseBill, v.date),
        date: v.date,
        dueDate: v.dueDate ?? null,
        supplierId: v.supplierId,
        grnId: v.grnId,
        supplierBillNo: v.supplierBillNo ?? null,
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx
      .insert(billLines)
      .values(lines.map((l) => ({ billId: b.id, grnLineId: l.grnLineId, itemId: l.itemId, qty: l.qty, rate: r(l.rate), amount: m(l.amount) })));
    return b;
  });
}

async function recomputeBilled(tx: Tx, grnLineIds: number[]) {
  if (!grnLineIds.length) return;
  await tx.execute(sql`
    UPDATE grn_lines gl SET billed_qty = coalesce((
      SELECT sum(bl.qty) FROM bill_lines bl JOIN purchase_bills b ON b.id = bl.bill_id
      WHERE bl.grn_line_id = gl.id AND b.status = 'submitted'), 0)
    WHERE gl.id IN ${sql.raw(`(${grnLineIds.join(",")})`)}`);
}

async function lockBill(tx: Tx, id: number) {
  const [b] = await tx.select().from(purchaseBills).where(eq(purchaseBills.id, id)).for("update");
  if (!b) throw new DomainError(`Purchase bill #${id} not found`);
  return b;
}

export async function submitPurchaseBill(id: number) {
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, id);
    assert(b.status === "draft", `${b.no} is ${b.status}, only drafts can be submitted`);
    const g = await lockGrn(tx, b.grnId!);
    assert(g.status === "submitted", `${g.no} is ${g.status}`);
    const lines = await tx.select().from(billLines).where(eq(billLines.billId, id));
    const ids = lines.map((l) => l.grnLineId);
    await tx.update(purchaseBills).set({ status: "submitted", submittedAt: new Date() }).where(eq(purchaseBills.id, id));
    await recomputeBilled(tx, ids);
    const over = await tx.select().from(grnLines).where(and(inArray(grnLines.id, ids), sql`${grnLines.billedQty} > ${grnLines.qty}`));
    assert(over.length === 0, "Billed qty is more than received qty on the goods receipt");
    await postParty(tx, {
      date: b.date,
      partyType: "supplier",
      partyId: b.supplierId,
      amount: toNum(b.total),
      voucherType: "purchase_bill",
      voucherId: id,
      againstType: "purchase_bill",
      againstId: id,
      dueDate: b.dueDate ?? b.date,
    });
  });
}

export async function cancelPurchaseBill(id: number) {
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, id);
    assert(b.status === "submitted", `${b.no} is ${b.status}`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(supplierPaymentAllocations)
      .innerJoin(supplierPayments, eq(supplierPayments.id, supplierPaymentAllocations.paymentId))
      .where(and(eq(supplierPaymentAllocations.billId, id), eq(supplierPayments.status, "submitted")));
    assert(n === 0, `${b.no} has payments against it. Cancel them first.`);
    await reverseParty(tx, "purchase_bill", id, today());
    await tx.update(purchaseBills).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(purchaseBills.id, id));
    const lines = await tx.select().from(billLines).where(eq(billLines.billId, id));
    await recomputeBilled(
      tx,
      lines.map((l) => l.grnLineId),
    );
  });
}

// ───────────────────────── Supplier Payment ─────────────────────────

export const supplierPaymentInput = z.object({
  supplierId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive("Amount must be more than 0"),
  method: z.enum(["cash", "bank", "cheque"]).default("cash"),
  reference: z.string().optional().nullable(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  /** Empty = allocate automatically, oldest due bill first, at submit. */
  allocations: z.array(z.object({ billId: z.coerce.number().int().positive(), amount: z.coerce.number().positive() })).default([]),
});

export async function createSupplierPayment(input: unknown) {
  const v = supplierPaymentInput.parse(input);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(supplierPayments)
      .values({
        no: await nextNo(tx, SERIES.supplierPayment, v.date),
        date: v.date,
        supplierId: v.supplierId,
        amount: m(v.amount),
        method: v.method,
        reference: v.reference ?? null,
        remarks: v.remarks ?? null,
      })
      .returning();
    if (v.allocations.length) {
      await tx.insert(supplierPaymentAllocations).values(v.allocations.map((a) => ({ paymentId: p.id, billId: a.billId, amount: m(a.amount) })));
    }
    return p;
  });
}

export async function submitSupplierPayment(id: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, id)).for("update");
    if (!p) throw new DomainError(`Payment #${id} not found`);
    assert(p.status === "draft", `${p.no} is ${p.status}, only drafts can be submitted`);
    const amount = toNum(p.amount);
    const docs = await openDocs(tx, "supplier", p.supplierId, "purchase_bill");
    let allocs = (await tx.select().from(supplierPaymentAllocations).where(eq(supplierPaymentAllocations.paymentId, id))).map((a) => ({
      docId: a.billId,
      amount: toNum(a.amount),
    }));
    if (!allocs.length) {
      allocs = autoAllocate(amount, docs);
      if (allocs.length) {
        await tx.insert(supplierPaymentAllocations).values(allocs.map((a) => ({ paymentId: id, billId: a.docId, amount: m(a.amount) })));
      }
    }
    const allocated = checkAllocations(amount, allocs, docs, "bill");
    for (const a of allocs) {
      await postParty(tx, {
        date: p.date,
        partyType: "supplier",
        partyId: p.supplierId,
        amount: -a.amount,
        voucherType: "supplier_payment",
        voucherId: id,
        againstType: "purchase_bill",
        againstId: a.docId,
      });
    }
    await postParty(tx, {
      date: p.date,
      partyType: "supplier",
      partyId: p.supplierId,
      amount: -round2(amount - allocated),
      voucherType: "supplier_payment",
      voucherId: id,
      againstType: "supplier_payment",
      againstId: id,
    });
    await tx.update(supplierPayments).set({ status: "submitted", submittedAt: new Date() }).where(eq(supplierPayments.id, id));
  });
}

export async function cancelSupplierPayment(id: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, id)).for("update");
    if (!p) throw new DomainError(`Payment #${id} not found`);
    assert(p.status === "submitted", `${p.no} is ${p.status}`);
    await reverseParty(tx, "supplier_payment", id, today());
    await tx.update(supplierPayments).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(supplierPayments.id, id));
  });
}

export async function billOutstanding(billId: number) {
  return outstanding(db, "purchase_bill", billId);
}
