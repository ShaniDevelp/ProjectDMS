import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { batchBalances, poLines, soLines, stockBalances, stockLedger } from "@/db/schema";
import { createStockAdjustment, createStockTransfer, submitStockAdjustment, submitStockTransfer } from "@/server/inventory";
import { saveCustomer } from "@/server/masters";
import { partyBalance } from "@/server/party";
import {
  cancelGrn,
  createGrn,
  createPurchaseBill,
  createPurchaseOrder,
  createSupplierPayment,
  billOutstanding,
  setPurchaseOrderClosed,
  submitGrn,
  submitPurchaseBill,
  submitPurchaseOrder,
  submitSupplierPayment,
} from "@/server/purchasing";
import {
  cancelReceipt,
  cancelSalesInvoice,
  cancelSalesReturn,
  createReceipt,
  createSalesInvoice,
  createSalesOrder,
  createSalesReturn,
  creditStatus,
  invoiceOutstanding,
  submitReceipt,
  submitSalesInvoice,
  submitSalesOrder,
  submitSalesReturn,
} from "@/server/selling";
import { addDays, today, toNum } from "@/server/util";
import { closeDb, resetDb, seedBasics } from "./helpers";

type Seed = Awaited<ReturnType<typeof seedBasics>>;
let s: Seed;

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeDb);

async function balance(itemId: number, warehouseId: number) {
  const [b] = await db
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.warehouseId, warehouseId)));
  return { qty: b?.qty ?? 0, value: toNum(b?.value), rate: toNum(b?.valuationRate) };
}

async function batchQty(batchNo: string, warehouseId: number) {
  const res = await db.execute<{ q: number }>(sql`
    SELECT coalesce(sum(bb.qty),0)::int AS q FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id
    WHERE b.batch_no = ${batchNo} AND bb.warehouse_id = ${warehouseId}`);
  return res.rows[0].q;
}

/** Receive stock directly (GRN without PO). */
async function receive(itemId: number, qty: number, rate: number, batchNo?: string, expiryDate?: string) {
  const g = await createGrn({
    supplierId: s.supplier.id,
    warehouseId: s.godown.id,
    lines: [{ itemId, qty, rate, batchNo, expiryDate }],
  });
  await submitGrn(g.id);
  return g;
}

describe("procurement", () => {
  it("PO → partial GRN tracks received qty, blocks over-receipt, and can be closed", async () => {
    const po = await createPurchaseOrder({
      supplierId: s.supplier.id,
      warehouseId: s.godown.id,
      lines: [{ itemId: s.tea.id, qty: 100, rate: 900 }],
    });
    expect(po.no).toMatch(/^PO-\d{4}-00001$/);
    await submitPurchaseOrder(po.id);
    const [pl] = await db.select().from(poLines).where(eq(poLines.poId, po.id));

    const g = await createGrn({
      supplierId: s.supplier.id,
      poId: po.id,
      warehouseId: s.godown.id,
      lines: [{ poLineId: pl.id, itemId: s.tea.id, qty: 90, rejectedQty: 2, rate: 900 }],
    });
    await submitGrn(g.id);
    expect((await db.select().from(poLines).where(eq(poLines.id, pl.id)))[0].receivedQty).toBe(90);
    expect(await balance(s.tea.id, s.godown.id)).toEqual({ qty: 90, value: 81000, rate: 900 });

    const g2 = await createGrn({
      supplierId: s.supplier.id,
      poId: po.id,
      warehouseId: s.godown.id,
      lines: [{ poLineId: pl.id, itemId: s.tea.id, qty: 20, rate: 900 }],
    });
    await expect(submitGrn(g2.id)).rejects.toThrow(/more than ordered/);
    expect((await balance(s.tea.id, s.godown.id)).qty).toBe(90); // rolled back

    await setPurchaseOrderClosed(po.id, true);
    await expect(
      createGrn({ supplierId: s.supplier.id, poId: po.id, warehouseId: s.godown.id, lines: [{ poLineId: pl.id, itemId: s.tea.id, qty: 5, rate: 900 }] }),
    ).rejects.toThrow(/not open/);
  });

  it("moving average valuation across two receipts", async () => {
    await receive(s.tea.id, 100, 900);
    await receive(s.tea.id, 100, 1000);
    expect(await balance(s.tea.id, s.godown.id)).toEqual({ qty: 200, value: 190000, rate: 950 });
  });

  it("bill → partial supplier payment → outstanding; GRN cannot be cancelled once billed", async () => {
    const g = await receive(s.tea.id, 10, 900);
    const gl = (await db.execute<{ id: number }>(sql`SELECT id FROM grn_lines WHERE grn_id = ${g.id}`)).rows[0];
    const bill = await createPurchaseBill({ supplierId: s.supplier.id, grnId: g.id, lines: [{ grnLineId: gl.id, qty: 10, rate: 900 }] });
    await submitPurchaseBill(bill.id);
    expect(await partyBalance(db, "supplier", s.supplier.id)).toBe(9000);
    await expect(cancelGrn(g.id)).rejects.toThrow(/purchase bills/);

    const pay = await createSupplierPayment({ supplierId: s.supplier.id, amount: 4000 });
    await submitSupplierPayment(pay.id);
    expect(await billOutstanding(bill.id)).toBe(5000);
    expect(await partyBalance(db, "supplier", s.supplier.id)).toBe(5000);
  });

  it("cancelling a GRN fails if its stock was already sold", async () => {
    const g = await receive(s.tea.id, 10, 900);
    const inv = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 6, rate: 1000 }] });
    await submitSalesInvoice(inv.id);
    await expect(cancelGrn(g.id)).rejects.toThrow(/Not enough stock/);
  });
});

describe("selling", () => {
  it("SO → partial invoice with FEFO batches, cost at valuation, SO invoiced qty", async () => {
    await receive(s.oil.id, 10, 2500, "LATE", addDays(today(), 90));
    await receive(s.oil.id, 10, 2500, "EARLY", addDays(today(), 30));
    await receive(s.oil.id, 10, 2500, "DEAD", addDays(today(), -1)); // expired

    const so = await createSalesOrder({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.oil.id, qty: 15, rate: 2800 }] });
    await submitSalesOrder(so.id);
    const [sl] = await db.select().from(soLines).where(eq(soLines.soId, so.id));
    expect((await creditStatus(db, s.shop.id)).openOrders).toBe(42000);

    const inv = await createSalesInvoice({
      customerId: s.shop.id,
      soId: so.id,
      warehouseId: s.godown.id,
      lines: [{ soLineId: sl.id, itemId: s.oil.id, qty: 12, rate: 2800 }],
    });
    await submitSalesInvoice(inv.id);

    expect(await batchQty("EARLY", s.godown.id)).toBe(0);
    expect(await batchQty("LATE", s.godown.id)).toBe(8);
    expect(await batchQty("DEAD", s.godown.id)).toBe(10); // never sold
    expect((await db.select().from(soLines).where(eq(soLines.id, sl.id)))[0].invoicedQty).toBe(12);
    expect(await invoiceOutstanding(inv.id)).toBe(33600);
    const cs = await creditStatus(db, s.shop.id);
    expect(cs.balance).toBe(33600);
    expect(cs.openOrders).toBe(8400); // 3 pcs still to deliver

    // Cannot deliver beyond the order.
    const inv2 = await createSalesInvoice({
      customerId: s.shop.id,
      soId: so.id,
      warehouseId: s.godown.id,
      lines: [{ soLineId: sl.id, itemId: s.oil.id, qty: 4, rate: 2800 }],
    });
    await expect(submitSalesInvoice(inv2.id)).rejects.toThrow(/more than ordered/);
  });

  it("expired-only stock cannot be sold", async () => {
    await receive(s.oil.id, 5, 2500, "DEAD", addDays(today(), -1));
    const inv = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.oil.id, qty: 1, rate: 2800 }] });
    await expect(submitSalesInvoice(inv.id)).rejects.toThrow(/non-expired/);
  });

  it("credit limit blocks a sales order", async () => {
    const tight = await saveCustomer({ name: "Tight Shop", creditLimit: 5000, creditDays: 7 });
    const so = await createSalesOrder({ customerId: tight.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 6, rate: 1000 }] });
    await expect(submitSalesOrder(so.id)).rejects.toThrow(/Credit limit exceeded/);
    await saveCustomer({ name: "Tight Shop", creditLimit: 5000, creditDays: 7, creditOverride: true }, tight.id);
    await submitSalesOrder(so.id);
  });

  it("overdue bills block new orders", async () => {
    await receive(s.tea.id, 10, 900);
    const inv = await createSalesInvoice({
      customerId: s.shop.id,
      warehouseId: s.godown.id,
      date: addDays(today(), -20), // due 15 days later = 5 days ago
      lines: [{ itemId: s.tea.id, qty: 2, rate: 1000 }],
    });
    await submitSalesInvoice(inv.id);
    const so = await createSalesOrder({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 1, rate: 1000 }] });
    await expect(submitSalesOrder(so.id)).rejects.toThrow(/overdue/);
    const rc = await createReceipt({ customerId: s.shop.id, amount: 2000 });
    await submitReceipt(rc.id);
    await submitSalesOrder(so.id);
  });

  it("receipt auto-allocates oldest first; extra stays as advance", async () => {
    await receive(s.tea.id, 20, 900);
    const a = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, date: addDays(today(), -3), lines: [{ itemId: s.tea.id, qty: 3, rate: 1000 }] });
    await submitSalesInvoice(a.id);
    const b = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 5, rate: 1000 }] });
    await submitSalesInvoice(b.id);

    const rc = await createReceipt({ customerId: s.shop.id, amount: 4000 });
    await submitReceipt(rc.id);
    expect(await invoiceOutstanding(a.id)).toBe(0);
    expect(await invoiceOutstanding(b.id)).toBe(4000);

    const big = await createReceipt({ customerId: s.shop.id, amount: 5000 });
    await submitReceipt(big.id);
    expect(await invoiceOutstanding(b.id)).toBe(0);
    expect(await partyBalance(db, "customer", s.shop.id)).toBe(-1000); // advance

    await cancelReceipt(big.id);
    expect(await invoiceOutstanding(b.id)).toBe(4000);
  });

  it("returns: good stock back at original cost, damaged credit only, cap on qty, full unwind", async () => {
    await receive(s.tea.id, 10, 900);
    const inv = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 6, rate: 1000 }] });
    await submitSalesInvoice(inv.id);
    const il = (await db.execute<{ id: number }>(sql`SELECT id FROM invoice_lines WHERE invoice_id = ${inv.id}`)).rows[0];

    const ret = await createSalesReturn({
      invoiceId: inv.id,
      warehouseId: s.godown.id,
      lines: [{ invoiceLineId: il.id, qty: 2, condition: "good" }],
    });
    await submitSalesReturn(ret.id);
    expect(await balance(s.tea.id, s.godown.id)).toEqual({ qty: 6, value: 5400, rate: 900 });
    expect(await invoiceOutstanding(inv.id)).toBe(4000);

    const dmg = await createSalesReturn({ invoiceId: inv.id, warehouseId: s.godown.id, reason: "damaged", lines: [{ invoiceLineId: il.id, qty: 1, condition: "damaged" }] });
    await submitSalesReturn(dmg.id);
    expect((await balance(s.tea.id, s.godown.id)).qty).toBe(6);
    expect(await invoiceOutstanding(inv.id)).toBe(3000);

    const tooMany = await createSalesReturn({ invoiceId: inv.id, warehouseId: s.godown.id, lines: [{ invoiceLineId: il.id, qty: 4 }] });
    await expect(submitSalesReturn(tooMany.id)).rejects.toThrow(/more than the invoiced/);

    // Invoice cannot be cancelled while returns exist; unwind in order.
    await expect(cancelSalesInvoice(inv.id)).rejects.toThrow(/returns/);
    await cancelSalesReturn(dmg.id);
    await cancelSalesReturn(ret.id);
    await cancelSalesInvoice(inv.id);
    expect(await balance(s.tea.id, s.godown.id)).toEqual({ qty: 10, value: 9000, rate: 900 });
    expect(await partyBalance(db, "customer", s.shop.id)).toBe(0);
  });
});

describe("inventory", () => {
  it("transfer to van keeps total value; damage write-off takes expired batch", async () => {
    await receive(s.oil.id, 10, 2500, "B1", addDays(today(), -5));
    await receive(s.tea.id, 24, 900);
    const t = await createStockTransfer({ fromWarehouseId: s.godown.id, toWarehouseId: s.van.id, lines: [{ itemId: s.tea.id, qty: 12 }] });
    await submitStockTransfer(t.id);
    expect(await balance(s.tea.id, s.godown.id)).toEqual({ qty: 12, value: 10800, rate: 900 });
    expect(await balance(s.tea.id, s.van.id)).toEqual({ qty: 12, value: 10800, rate: 900 });

    const adj = await createStockAdjustment({ warehouseId: s.godown.id, reason: "expiry", lines: [{ itemId: s.oil.id, qtyChange: -10 }] });
    await submitStockAdjustment(adj.id);
    expect(await balance(s.oil.id, s.godown.id)).toEqual({ qty: 0, value: 0, rate: 2500 });
    const bb = await db.select().from(batchBalances).where(eq(batchBalances.itemId, s.oil.id));
    expect(bb.every((b) => b.qty === 0)).toBe(true);
  });

  it("ledger running qty always equals the cached balance", async () => {
    await receive(s.tea.id, 50, 900);
    const inv = await createSalesInvoice({ customerId: s.shop.id, warehouseId: s.godown.id, lines: [{ itemId: s.tea.id, qty: 7, rate: 1000 }] });
    await submitSalesInvoice(inv.id);
    const [{ q, v }] = (
      await db.execute<{ q: number; v: string }>(
        sql`SELECT sum(qty)::int AS q, sum(value_change) AS v FROM stock_ledger WHERE item_id = ${s.tea.id} AND warehouse_id = ${s.godown.id}`,
      )
    ).rows;
    const b = await balance(s.tea.id, s.godown.id);
    expect(q).toBe(b.qty);
    expect(toNum(v)).toBe(b.value);
    const rows = await db.select().from(stockLedger).where(eq(stockLedger.itemId, s.tea.id));
    expect(rows.at(-1)!.qtyAfter).toBe(43);
  });
});
