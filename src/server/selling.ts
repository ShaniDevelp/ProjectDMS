import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import {
  customers,
  invoiceLineAllocations,
  invoiceLines,
  items,
  receiptAllocations,
  receipts,
  returnLines,
  salesInvoices,
  salesOrders,
  salesReturns,
  soLines,
  stockLedger,
} from "@/db/schema";
import { autoAllocate, checkAllocations, openDocs } from "./allocation";
import { nextNo, SERIES } from "./numbering";
import { outstanding, partyBalance, postParty, reverseParty } from "./party";
import { allocateFefo, move, reverseStock } from "./stock";
import { addDays, assert, DomainError, m, r, round2, today, toNum } from "./util";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const money = z.coerce.number().min(0);
const optId = z.coerce
  .number()
  .int()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

// ───────────────────────── Credit control ─────────────────────────

export type CreditStatus = {
  balance: number;
  openOrders: number;
  exposure: number;
  creditLimit: number | null;
  overdueCount: number;
  overdueAmount: number;
};

export async function creditStatus(dbx: Tx | typeof db, customerId: number, onDate = today()): Promise<CreditStatus> {
  const [c] = await dbx.select().from(customers).where(eq(customers.id, customerId));
  if (!c) throw new DomainError(`Customer #${customerId} not found`);
  const balance = await partyBalance(dbx, "customer", customerId);
  const [{ open }] = await dbx
    .select({ open: sql<string>`coalesce(sum(greatest(${soLines.qty} - ${soLines.invoicedQty}, 0) * ${soLines.rate}), 0)` })
    .from(soLines)
    .innerJoin(salesOrders, eq(salesOrders.id, soLines.soId))
    .where(and(eq(salesOrders.customerId, customerId), eq(salesOrders.status, "submitted"), eq(salesOrders.closed, false)));
  const docs = await openDocs(dbx, "customer", customerId, "sales_invoice");
  const overdue = docs.filter((d) => d.dueDate !== null && d.dueDate < onDate);
  const openOrders = round2(toNum(open));
  return {
    balance,
    openOrders,
    exposure: round2(balance + openOrders),
    creditLimit: c.creditLimit === null ? null : toNum(c.creditLimit),
    overdueCount: overdue.length,
    overdueAmount: round2(overdue.reduce((s, d) => s + d.outstanding, 0)),
  };
}

const fmt = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

/** Throws when a customer is blocked, over limit, or (optionally) has overdue bills. */
async function enforceCredit(tx: Tx, customerId: number, opts: { checkOverdue: boolean; onDate: string }) {
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
  if (!c) throw new DomainError(`Customer #${customerId} not found`);
  if (c.blocked) throw new DomainError(`${c.name} is blocked`);
  if (c.creditOverride) return;
  const s = await creditStatus(tx, customerId, opts.onDate);
  if (opts.checkOverdue && s.overdueCount > 0) {
    throw new DomainError(`${c.name} has ${s.overdueCount} overdue bill(s) totalling Rs ${fmt(s.overdueAmount)}. Collect payment first.`);
  }
  if (s.creditLimit !== null && s.exposure > s.creditLimit) {
    throw new DomainError(
      `Credit limit exceeded for ${c.name}: owes Rs ${fmt(s.balance)} + open orders Rs ${fmt(s.openOrders)} = Rs ${fmt(
        s.exposure,
      )}, limit Rs ${fmt(s.creditLimit)}`,
    );
  }
}

// ───────────────────────── Sales Order ─────────────────────────

export const soInput = z.object({
  customerId: z.coerce.number().int().positive(),
  salespersonId: optId,
  warehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int("Qty must be whole pieces").positive("Qty must be more than 0"),
        rate: money,
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createSalesOrder(input: unknown) {
  const v = soInput.parse(input);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, v.customerId));
    assert(c, "Customer not found");
    const lines = v.lines.map((l) => ({ ...l, amount: round2(l.qty * l.rate) }));
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const [so] = await tx
      .insert(salesOrders)
      .values({
        no: await nextNo(tx, SERIES.salesOrder, v.date),
        date: v.date,
        customerId: v.customerId,
        salespersonId: v.salespersonId ?? c.salespersonId,
        warehouseId: v.warehouseId,
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx.insert(soLines).values(lines.map((l) => ({ soId: so.id, itemId: l.itemId, qty: l.qty, rate: r(l.rate), amount: m(l.amount) })));
    return so;
  });
}

async function lockSo(tx: Tx, id: number) {
  const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id)).for("update");
  if (!so) throw new DomainError(`Sales order #${id} not found`);
  return so;
}

export async function submitSalesOrder(id: number) {
  return db.transaction(async (tx) => {
    const so = await lockSo(tx, id);
    assert(so.status === "draft", `${so.no} is ${so.status}, only drafts can be submitted`);
    await tx.update(salesOrders).set({ status: "submitted", submittedAt: new Date() }).where(eq(salesOrders.id, id));
    // Checked after the status flip so this order's value counts toward exposure.
    await enforceCredit(tx, so.customerId, { checkOverdue: true, onDate: today() });
  });
}

export async function cancelSalesOrder(id: number) {
  return db.transaction(async (tx) => {
    const so = await lockSo(tx, id);
    assert(so.status === "submitted", `${so.no} is ${so.status}`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.soId, id), eq(salesInvoices.status, "submitted")));
    assert(n === 0, `${so.no} has invoices. Cancel them first, or close the order.`);
    await tx.update(salesOrders).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(salesOrders.id, id));
  });
}

export async function setSalesOrderClosed(id: number, closed: boolean) {
  return db.transaction(async (tx) => {
    const so = await lockSo(tx, id);
    assert(so.status === "submitted", `${so.no} is ${so.status}`);
    await tx.update(salesOrders).set({ closed }).where(eq(salesOrders.id, id));
    if (!closed) await enforceCredit(tx, so.customerId, { checkOverdue: false, onDate: today() });
  });
}

async function recomputeInvoiced(tx: Tx, soLineIds: number[]) {
  if (!soLineIds.length) return;
  await tx.execute(sql`
    UPDATE so_lines sl SET invoiced_qty = coalesce((
      SELECT sum(il.qty) FROM invoice_lines il JOIN sales_invoices i ON i.id = il.invoice_id
      WHERE il.so_line_id = sl.id AND i.status = 'submitted'), 0)
    WHERE sl.id IN ${sql.raw(`(${soLineIds.join(",")})`)}`);
}

// ───────────────────────── Sales Invoice (delivers + bills) ─────────────────────────

export const invoiceInput = z.object({
  customerId: z.coerce.number().int().positive(),
  soId: optId,
  salespersonId: optId,
  warehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        soLineId: optId,
        itemId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int("Qty must be whole pieces").min(0),
        rate: money,
      }),
    )
    .min(1, "Add at least one item"),
});

export async function createSalesInvoice(input: unknown) {
  const v = invoiceInput.parse(input);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, v.customerId));
    assert(c, "Customer not found");
    const lines = v.lines.filter((l) => l.qty > 0);
    assert(lines.length > 0, "Enter a qty on at least one line");
    if (v.soId) {
      const so = await lockSo(tx, v.soId);
      assert(so.status === "submitted" && !so.closed, `${so.no} is not open for invoicing`);
      assert(so.customerId === v.customerId, `${so.no} belongs to another customer`);
      const sls = await tx.select().from(soLines).where(eq(soLines.soId, v.soId));
      for (const l of lines) {
        if (!l.soLineId) continue;
        const sl = sls.find((s) => s.id === l.soLineId);
        assert(sl && sl.itemId === l.itemId, "Invoice line does not match the sales order");
      }
    }
    const rows = lines.map((l) => ({ ...l, amount: round2(l.qty * l.rate) }));
    const total = round2(rows.reduce((s, l) => s + l.amount, 0));
    const [inv] = await tx
      .insert(salesInvoices)
      .values({
        no: await nextNo(tx, SERIES.salesInvoice, v.date),
        date: v.date,
        customerId: v.customerId,
        soId: v.soId ?? null,
        salespersonId: v.salespersonId ?? c.salespersonId,
        warehouseId: v.warehouseId,
        dueDate: addDays(v.date, c.creditDays),
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx.insert(invoiceLines).values(
      rows.map((l) => ({ invoiceId: inv.id, soLineId: l.soLineId ?? null, itemId: l.itemId, qty: l.qty, rate: r(l.rate), amount: m(l.amount) })),
    );
    return inv;
  });
}

async function lockInvoice(tx: Tx, id: number) {
  const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, id)).for("update");
  if (!inv) throw new DomainError(`Invoice #${id} not found`);
  return inv;
}

export async function submitSalesInvoice(id: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    assert(inv.status === "draft", `${inv.no} is ${inv.status}, only drafts can be submitted`);
    if (inv.soId) {
      const so = await lockSo(tx, inv.soId);
      assert(so.status === "submitted" && !so.closed, `${so.no} is not open for invoicing`);
    }
    const lines = await tx
      .select({ line: invoiceLines, hasBatch: items.hasBatch })
      .from(invoiceLines)
      .innerJoin(items, eq(items.id, invoiceLines.itemId))
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(invoiceLines.itemId);

    let cost = 0;
    for (const { line, hasBatch } of lines) {
      const picks = hasBatch
        ? await allocateFefo(tx, { itemId: line.itemId, warehouseId: inv.warehouseId, qty: line.qty, onDate: inv.date })
        : [{ batchId: null as number | null, qty: line.qty }];
      for (const p of picks) {
        const posted = await move(tx, {
          itemId: line.itemId,
          warehouseId: inv.warehouseId,
          batchId: p.batchId,
          qty: -p.qty,
          voucherType: "sales_invoice",
          voucherId: id,
          voucherLineId: line.id,
        });
        cost += -posted.valueChange;
        await tx.insert(invoiceLineAllocations).values({ invoiceLineId: line.id, batchId: p.batchId, qty: p.qty, costRate: r(posted.costRate) });
      }
    }

    // Flip status first: the recompute sums *submitted* invoice lines, including this one.
    await tx
      .update(salesInvoices)
      .set({ status: "submitted", submittedAt: new Date(), cost: m(cost) })
      .where(eq(salesInvoices.id, id));
    const soLineIds = lines.map((l) => l.line.soLineId).filter((x): x is number => !!x);
    await recomputeInvoiced(tx, soLineIds);
    if (soLineIds.length) {
      const over = await tx.select().from(soLines).where(and(inArray(soLines.id, soLineIds), sql`${soLines.invoicedQty} > ${soLines.qty}`));
      assert(over.length === 0, "Invoiced qty is more than ordered qty on the sales order");
    }
    await postParty(tx, {
      date: inv.date,
      partyType: "customer",
      partyId: inv.customerId,
      amount: toNum(inv.total),
      voucherType: "sales_invoice",
      voucherId: id,
      againstType: "sales_invoice",
      againstId: id,
      dueDate: inv.dueDate,
    });
    // Order-linked lines were credit-checked at order time; only check free (unordered) sales.
    const hasUnordered = lines.some((l) => !l.line.soLineId);
    if (hasUnordered) await enforceCredit(tx, inv.customerId, { checkOverdue: !inv.soId, onDate: inv.date });
  });
}

export async function cancelSalesInvoice(id: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    assert(inv.status === "submitted", `${inv.no} is ${inv.status}`);
    const [{ ret }] = await tx
      .select({ ret: sql<number>`count(*)::int` })
      .from(salesReturns)
      .where(and(eq(salesReturns.invoiceId, id), eq(salesReturns.status, "submitted")));
    assert(ret === 0, `${inv.no} has sales returns. Cancel them first.`);
    const [{ rc }] = await tx
      .select({ rc: sql<number>`count(*)::int` })
      .from(receiptAllocations)
      .innerJoin(receipts, eq(receipts.id, receiptAllocations.receiptId))
      .where(and(eq(receiptAllocations.invoiceId, id), eq(receipts.status, "submitted")));
    assert(rc === 0, `${inv.no} has payments received. Cancel those receipts first.`);

    await reverseStock(tx, "sales_invoice", id);
    await reverseParty(tx, "sales_invoice", id, today());
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    await tx.delete(invoiceLineAllocations).where(
      inArray(
        invoiceLineAllocations.invoiceLineId,
        lines.map((l) => l.id),
      ),
    );
    await tx.update(salesInvoices).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(salesInvoices.id, id));
    await recomputeInvoiced(
      tx,
      lines.map((l) => l.soLineId).filter((x): x is number => !!x),
    );
  });
}

// ───────────────────────── Sales Return (credit note) ─────────────────────────

export const returnInput = z.object({
  invoiceId: z.coerce.number().int().positive(),
  warehouseId: z.coerce.number().int().positive(),
  date: isoDate.default(today),
  reason: z.enum(["unsold", "damaged", "expired", "wrong_item", "other"]).default("unsold"),
  remarks: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().min(0),
        condition: z.enum(["good", "damaged"]).default("good"),
      }),
    )
    .min(1),
});

export async function createSalesReturn(input: unknown) {
  const v = returnInput.parse(input);
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, v.invoiceId);
    assert(inv.status === "submitted", `${inv.no} must be submitted`);
    const ils = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, v.invoiceId));
    const rows = v.lines
      .filter((l) => l.qty > 0)
      .map((l) => {
        const il = ils.find((x) => x.id === l.invoiceLineId);
        assert(il, "Return line does not match the invoice");
        const rate = toNum(il.rate);
        return { ...l, itemId: il.itemId, rate, amount: round2(l.qty * rate) };
      });
    assert(rows.length > 0, "Enter a return qty on at least one line");
    const total = round2(rows.reduce((s, l) => s + l.amount, 0));
    const [ret] = await tx
      .insert(salesReturns)
      .values({
        no: await nextNo(tx, SERIES.salesReturn, v.date),
        date: v.date,
        customerId: inv.customerId,
        invoiceId: v.invoiceId,
        warehouseId: v.warehouseId,
        reason: v.reason,
        remarks: v.remarks ?? null,
        total: m(total),
      })
      .returning();
    await tx.insert(returnLines).values(
      rows.map((l) => ({
        returnId: ret.id,
        invoiceLineId: l.invoiceLineId,
        itemId: l.itemId,
        qty: l.qty,
        rate: r(l.rate),
        amount: m(l.amount),
        condition: l.condition,
      })),
    );
    return ret;
  });
}

async function recomputeReturned(tx: Tx, invoiceLineIds: number[]) {
  if (!invoiceLineIds.length) return;
  await tx.execute(sql`
    UPDATE invoice_lines il SET returned_qty = coalesce((
      SELECT sum(rl.qty) FROM return_lines rl JOIN sales_returns sr ON sr.id = rl.return_id
      WHERE rl.invoice_line_id = il.id AND sr.status = 'submitted'), 0)
    WHERE il.id IN ${sql.raw(`(${invoiceLineIds.join(",")})`)}`);
}

export async function submitSalesReturn(id: number) {
  return db.transaction(async (tx) => {
    const [ret] = await tx.select().from(salesReturns).where(eq(salesReturns.id, id)).for("update");
    if (!ret) throw new DomainError(`Return #${id} not found`);
    assert(ret.status === "draft", `${ret.no} is ${ret.status}, only drafts can be submitted`);
    const inv = await lockInvoice(tx, ret.invoiceId);
    assert(inv.status === "submitted", `${inv.no} is ${inv.status}`);
    const lines = await tx.select().from(returnLines).where(eq(returnLines.returnId, id));
    const ilIds = lines.map((l) => l.invoiceLineId);

    await tx.update(salesReturns).set({ status: "submitted", submittedAt: new Date() }).where(eq(salesReturns.id, id));
    await recomputeReturned(tx, ilIds);
    const over = await tx.select().from(invoiceLines).where(and(inArray(invoiceLines.id, ilIds), sql`${invoiceLines.returnedQty} > ${invoiceLines.qty}`));
    assert(over.length === 0, "Returned qty is more than the invoiced qty");

    for (const line of lines) {
      if (line.condition !== "good") continue;
      // Put good stock back into the batches it left from, at its original cost.
      const allocs = await tx.select().from(invoiceLineAllocations).where(eq(invoiceLineAllocations.invoiceLineId, line.invoiceLineId));
      const backByBatch = await tx
        .select({ batchId: stockLedger.batchId, q: sql<number>`coalesce(sum(${stockLedger.qty}), 0)::int` })
        .from(stockLedger)
        .innerJoin(returnLines, eq(returnLines.id, stockLedger.voucherLineId))
        .where(and(eq(stockLedger.voucherType, "sales_return"), eq(returnLines.invoiceLineId, line.invoiceLineId)))
        .groupBy(stockLedger.batchId);
      let need = line.qty;
      for (const a of [...allocs].reverse()) {
        if (need <= 0) break;
        const already = backByBatch.find((b) => b.batchId === a.batchId)?.q ?? 0;
        const room = a.qty - already;
        if (room <= 0) continue;
        const take = Math.min(room, need);
        await move(tx, {
          itemId: line.itemId,
          warehouseId: ret.warehouseId,
          batchId: a.batchId,
          qty: take,
          rate: toNum(a.costRate),
          voucherType: "sales_return",
          voucherId: id,
          voucherLineId: line.id,
        });
        need -= take;
      }
      assert(need === 0, "Could not match returned qty to delivered batches");
    }

    // Credit reduces the invoice; anything beyond its open amount stays as customer credit on the return.
    const total = toNum(ret.total);
    const open = Math.max(0, await outstanding(tx, "sales_invoice", inv.id));
    const toInvoice = round2(Math.min(open, total));
    await postParty(tx, {
      date: ret.date,
      partyType: "customer",
      partyId: ret.customerId,
      amount: -toInvoice,
      voucherType: "sales_return",
      voucherId: id,
      againstType: "sales_invoice",
      againstId: inv.id,
    });
    await postParty(tx, {
      date: ret.date,
      partyType: "customer",
      partyId: ret.customerId,
      amount: -round2(total - toInvoice),
      voucherType: "sales_return",
      voucherId: id,
      againstType: "sales_return",
      againstId: id,
    });
  });
}

export async function cancelSalesReturn(id: number) {
  return db.transaction(async (tx) => {
    const [ret] = await tx.select().from(salesReturns).where(eq(salesReturns.id, id)).for("update");
    if (!ret) throw new DomainError(`Return #${id} not found`);
    assert(ret.status === "submitted", `${ret.no} is ${ret.status}`);
    await reverseStock(tx, "sales_return", id);
    await reverseParty(tx, "sales_return", id, today());
    await tx.update(salesReturns).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(salesReturns.id, id));
    const lines = await tx.select().from(returnLines).where(eq(returnLines.returnId, id));
    await recomputeReturned(
      tx,
      lines.map((l) => l.invoiceLineId),
    );
  });
}

// ───────────────────────── Receipts (collections) ─────────────────────────

export const receiptInput = z.object({
  customerId: z.coerce.number().int().positive(),
  salespersonId: optId,
  amount: z.coerce.number().positive("Amount must be more than 0"),
  method: z.enum(["cash", "bank", "cheque"]).default("cash"),
  reference: z.string().optional().nullable(),
  date: isoDate.default(today),
  remarks: z.string().optional().nullable(),
  /** Empty = allocate automatically, oldest due invoice first, at submit. */
  allocations: z.array(z.object({ invoiceId: z.coerce.number().int().positive(), amount: z.coerce.number().positive() })).default([]),
});

export async function createReceipt(input: unknown) {
  const v = receiptInput.parse(input);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, v.customerId));
    assert(c, "Customer not found");
    const [rc] = await tx
      .insert(receipts)
      .values({
        no: await nextNo(tx, SERIES.receipt, v.date),
        date: v.date,
        customerId: v.customerId,
        salespersonId: v.salespersonId ?? c.salespersonId,
        amount: m(v.amount),
        method: v.method,
        reference: v.reference ?? null,
        remarks: v.remarks ?? null,
      })
      .returning();
    if (v.allocations.length) {
      await tx.insert(receiptAllocations).values(v.allocations.map((a) => ({ receiptId: rc.id, invoiceId: a.invoiceId, amount: m(a.amount) })));
    }
    return rc;
  });
}

export async function submitReceipt(id: number) {
  return db.transaction(async (tx) => {
    const [rc] = await tx.select().from(receipts).where(eq(receipts.id, id)).for("update");
    if (!rc) throw new DomainError(`Receipt #${id} not found`);
    assert(rc.status === "draft", `${rc.no} is ${rc.status}, only drafts can be submitted`);
    // Serialise collections per customer so two receipts can't both take the same open amount.
    await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, rc.customerId)).for("update");
    const amount = toNum(rc.amount);
    const docs = await openDocs(tx, "customer", rc.customerId, "sales_invoice");
    let allocs = (await tx.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, id))).map((a) => ({
      docId: a.invoiceId,
      amount: toNum(a.amount),
    }));
    if (!allocs.length) {
      allocs = autoAllocate(amount, docs);
      if (allocs.length) {
        await tx.insert(receiptAllocations).values(allocs.map((a) => ({ receiptId: id, invoiceId: a.docId, amount: m(a.amount) })));
      }
    }
    const allocated = checkAllocations(amount, allocs, docs, "invoice");
    for (const a of allocs) {
      await postParty(tx, {
        date: rc.date,
        partyType: "customer",
        partyId: rc.customerId,
        amount: -a.amount,
        voucherType: "receipt",
        voucherId: id,
        againstType: "sales_invoice",
        againstId: a.docId,
      });
    }
    await postParty(tx, {
      date: rc.date,
      partyType: "customer",
      partyId: rc.customerId,
      amount: -round2(amount - allocated),
      voucherType: "receipt",
      voucherId: id,
      againstType: "receipt",
      againstId: id,
    });
    await tx.update(receipts).set({ status: "submitted", submittedAt: new Date() }).where(eq(receipts.id, id));
  });
}

export async function cancelReceipt(id: number) {
  return db.transaction(async (tx) => {
    const [rc] = await tx.select().from(receipts).where(eq(receipts.id, id)).for("update");
    if (!rc) throw new DomainError(`Receipt #${id} not found`);
    assert(rc.status === "submitted", `${rc.no} is ${rc.status}`);
    await reverseParty(tx, "receipt", id, today());
    await tx.update(receipts).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(receipts.id, id));
  });
}

export async function invoiceOutstanding(invoiceId: number) {
  return outstanding(db, "sales_invoice", invoiceId);
}

