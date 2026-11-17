import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import type { DocKind } from "@/lib/docs-meta";
import { creditStatus } from "./selling";
import { today, toNum } from "./util";

type Row = Record<string, unknown>;

async function q<T = Row>(query: SQL): Promise<T[]> {
  await connection(); // always read fresh at request time
  return (await db.execute(query)).rows as T[];
}

const n = (v: unknown) => toNum(v as string);

// ───────────────────────── derived statuses ─────────────────────────

export type Badge = { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" };

function lifecycle(status: string): Badge | null {
  if (status === "draft") return { label: "Draft", tone: "gray" };
  if (status === "cancelled") return { label: "Cancelled", tone: "red" };
  return null;
}

function progressBadge(done: number, total: number, words: [string, string, string]): Badge {
  if (total <= 0 || done <= 0) return { label: words[0], tone: "amber" };
  if (done < total) return { label: words[1], tone: "blue" };
  return { label: words[2], tone: "green" };
}

function payBadge(total: number, open: number, due: string | null): Badge {
  if (open <= 0) return { label: total > 0 ? "Paid" : "Settled", tone: "green" };
  if (due && due < today()) return { label: "Overdue", tone: "red" };
  if (open < total) return { label: "Partly Paid", tone: "blue" };
  return { label: "Unpaid", tone: "amber" };
}

export function badgeFor(kind: DocKind, r: Row): Badge {
  const life = lifecycle(String(r.status));
  if (life) return life;
  if ((kind === "purchase_order" || kind === "sales_order") && r.closed) return { label: "Closed", tone: "gray" };
  switch (kind) {
    case "purchase_order":
      return progressBadge(n(r.done_qty), n(r.total_qty), ["To Receive", "Partly Received", "Received"]);
    case "sales_order":
      return progressBadge(n(r.done_qty), n(r.total_qty), ["To Deliver", "Partly Delivered", "Delivered"]);
    case "grn":
      return progressBadge(n(r.done_qty), n(r.total_qty), ["To Bill", "Partly Billed", "Billed"]);
    case "sales_invoice":
    case "purchase_bill":
      return payBadge(n(r.total), n(r.open), (r.due_date as string) ?? null);
    default:
      return { label: "Submitted", tone: "green" };
  }
}

// ───────────────────────── lists ─────────────────────────

const LIST_SQL: Record<DocKind, SQL> = {
  sales_order: sql`SELECT d.id, d.no, d.date::text, d.status, d.closed, d.total, c.name AS party, sp.name AS extra,
      (SELECT sum(qty) FROM so_lines WHERE so_id = d.id) AS total_qty, (SELECT sum(least(invoiced_qty, qty)) FROM so_lines WHERE so_id = d.id) AS done_qty
    FROM sales_orders d JOIN customers c ON c.id = d.customer_id LEFT JOIN salespersons sp ON sp.id = d.salesperson_id`,
  sales_invoice: sql`SELECT d.id, d.no, d.date::text, d.status, d.total, d.due_date::text, c.name AS party, sp.name AS extra,
      (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE against_type='sales_invoice' AND against_id=d.id) AS open
    FROM sales_invoices d JOIN customers c ON c.id = d.customer_id LEFT JOIN salespersons sp ON sp.id = d.salesperson_id`,
  sales_return: sql`SELECT d.id, d.no, d.date::text, d.status, d.total, c.name AS party, i.no AS extra
    FROM sales_returns d JOIN customers c ON c.id = d.customer_id JOIN sales_invoices i ON i.id = d.invoice_id`,
  receipt: sql`SELECT d.id, d.no, d.date::text, d.status, d.amount AS total, c.name AS party, d.method AS extra
    FROM receipts d JOIN customers c ON c.id = d.customer_id`,
  purchase_order: sql`SELECT d.id, d.no, d.date::text, d.status, d.closed, d.total, s.name AS party, w.name AS extra,
      (SELECT sum(qty) FROM po_lines WHERE po_id = d.id) AS total_qty, (SELECT sum(least(received_qty, qty)) FROM po_lines WHERE po_id = d.id) AS done_qty
    FROM purchase_orders d JOIN suppliers s ON s.id = d.supplier_id JOIN warehouses w ON w.id = d.warehouse_id`,
  grn: sql`SELECT d.id, d.no, d.date::text, d.status, d.total, s.name AS party, w.name AS extra,
      (SELECT sum(qty) FROM grn_lines WHERE grn_id = d.id) AS total_qty, (SELECT sum(least(billed_qty, qty)) FROM grn_lines WHERE grn_id = d.id) AS done_qty
    FROM grns d JOIN suppliers s ON s.id = d.supplier_id JOIN warehouses w ON w.id = d.warehouse_id`,
  purchase_bill: sql`SELECT d.id, d.no, d.date::text, d.status, d.total, d.due_date::text, s.name AS party, d.supplier_bill_no AS extra,
      (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE against_type='purchase_bill' AND against_id=d.id) AS open
    FROM purchase_bills d JOIN suppliers s ON s.id = d.supplier_id`,
  supplier_payment: sql`SELECT d.id, d.no, d.date::text, d.status, d.amount AS total, s.name AS party, d.method AS extra
    FROM supplier_payments d JOIN suppliers s ON s.id = d.supplier_id`,
  stock_transfer: sql`SELECT d.id, d.no, d.date::text, d.status, NULL AS total, f.name || ' → ' || t.name AS party, NULL AS extra
    FROM stock_transfers d JOIN warehouses f ON f.id = d.from_warehouse_id JOIN warehouses t ON t.id = d.to_warehouse_id`,
  stock_adjustment: sql`SELECT d.id, d.no, d.date::text, d.status, NULL AS total, w.name AS party, d.reason AS extra
    FROM stock_adjustments d JOIN warehouses w ON w.id = d.warehouse_id`,
};

export async function listDocs(kind: DocKind) {
  const rows = await q(sql`SELECT * FROM (${LIST_SQL[kind]}) x ORDER BY x.id DESC LIMIT 300`);
  return rows.map((r) => ({
    id: Number(r.id),
    no: String(r.no),
    date: String(r.date),
    party: String(r.party ?? ""),
    extra: (r.extra as string | null) ?? null,
    total: r.total === null || r.total === undefined ? null : n(r.total),
    open: r.open === undefined ? null : n(r.open),
    badge: badgeFor(kind, r),
  }));
}

// ───────────────────────── single document ─────────────────────────

export type DocLine = Record<string, unknown> & { item_name?: string; pcs_per_carton?: number };
export type Related = { kind: DocKind; id: number; no: string; status: string };

export async function getDoc(kind: DocKind, id: number) {
  const [head] = await q(sql`SELECT * FROM (${LIST_SQL[kind]}) x WHERE x.id = ${id}`);
  if (!head) return null;
  let lines: DocLine[] = [];
  let related: Related[] = [];
  let allocations: Row[] = [];
  const itemCols = sql`it.name AS item_name, it.code AS item_code, it.pcs_per_carton, it.has_batch`;

  switch (kind) {
    case "purchase_order":
      lines = await q(sql`SELECT l.*, ${itemCols} FROM po_lines l JOIN items it ON it.id = l.item_id WHERE l.po_id = ${id} ORDER BY l.id`);
      related = await q(sql`SELECT 'grn' AS kind, id, no, status FROM grns WHERE po_id = ${id} ORDER BY id`);
      break;
    case "grn":
      lines = await q(sql`SELECT l.*, ${itemCols}, b.batch_no AS batch FROM grn_lines l JOIN items it ON it.id = l.item_id
        LEFT JOIN batches b ON b.id = l.batch_id WHERE l.grn_id = ${id} ORDER BY l.id`);
      related = await q(sql`
        SELECT 'purchase_order' AS kind, p.id, p.no, p.status FROM grns g JOIN purchase_orders p ON p.id = g.po_id WHERE g.id = ${id}
        UNION ALL SELECT 'purchase_bill', id, no, status FROM purchase_bills WHERE grn_id = ${id}`);
      break;
    case "purchase_bill":
      lines = await q(sql`SELECT l.*, ${itemCols} FROM bill_lines l JOIN items it ON it.id = l.item_id WHERE l.bill_id = ${id} ORDER BY l.id`);
      related = await q(sql`
        SELECT 'grn' AS kind, g.id, g.no, g.status FROM purchase_bills b JOIN grns g ON g.id = b.grn_id WHERE b.id = ${id}
        UNION ALL SELECT 'supplier_payment', p.id, p.no, p.status FROM supplier_payment_allocations a
          JOIN supplier_payments p ON p.id = a.payment_id WHERE a.bill_id = ${id}`);
      break;
    case "supplier_payment":
      allocations = await q(sql`SELECT a.amount, b.id AS doc_id, b.no FROM supplier_payment_allocations a
        JOIN purchase_bills b ON b.id = a.bill_id WHERE a.payment_id = ${id} ORDER BY a.id`);
      break;
    case "sales_order":
      lines = await q(sql`SELECT l.*, ${itemCols} FROM so_lines l JOIN items it ON it.id = l.item_id WHERE l.so_id = ${id} ORDER BY l.id`);
      related = await q(sql`SELECT 'sales_invoice' AS kind, id, no, status FROM sales_invoices WHERE so_id = ${id} ORDER BY id`);
      break;
    case "sales_invoice":
      lines = await q(sql`SELECT l.*, ${itemCols},
          (SELECT string_agg(coalesce(b.batch_no, '') || CASE WHEN b.expiry_date IS NOT NULL THEN ' (exp ' || b.expiry_date || ')' ELSE '' END
             || ' × ' || a.qty, ', ') FROM invoice_line_allocations a LEFT JOIN batches b ON b.id = a.batch_id
             WHERE a.invoice_line_id = l.id AND a.batch_id IS NOT NULL) AS batch
        FROM invoice_lines l JOIN items it ON it.id = l.item_id WHERE l.invoice_id = ${id} ORDER BY l.id`);
      related = await q(sql`
        SELECT 'sales_order' AS kind, s.id, s.no, s.status FROM sales_invoices i JOIN sales_orders s ON s.id = i.so_id WHERE i.id = ${id}
        UNION ALL SELECT 'sales_return', id, no, status FROM sales_returns WHERE invoice_id = ${id}
        UNION ALL SELECT 'receipt', r.id, r.no, r.status FROM receipt_allocations a JOIN receipts r ON r.id = a.receipt_id WHERE a.invoice_id = ${id}`);
      break;
    case "sales_return":
      lines = await q(sql`SELECT l.*, ${itemCols} FROM return_lines l JOIN items it ON it.id = l.item_id WHERE l.return_id = ${id} ORDER BY l.id`);
      related = await q(sql`SELECT 'sales_invoice' AS kind, i.id, i.no, i.status FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id WHERE r.id = ${id}`);
      break;
    case "receipt":
      allocations = await q(sql`SELECT a.amount, i.id AS doc_id, i.no FROM receipt_allocations a
        JOIN sales_invoices i ON i.id = a.invoice_id WHERE a.receipt_id = ${id} ORDER BY a.id`);
      break;
    case "stock_transfer":
      lines = await q(sql`SELECT l.*, ${itemCols}, b.batch_no AS batch FROM transfer_lines l JOIN items it ON it.id = l.item_id
        LEFT JOIN batches b ON b.id = l.batch_id WHERE l.transfer_id = ${id} ORDER BY l.id`);
      break;
    case "stock_adjustment":
      lines = await q(sql`SELECT l.*, l.qty_change AS qty, ${itemCols}, coalesce(b.batch_no, l.batch_no) AS batch FROM adjustment_lines l
        JOIN items it ON it.id = l.item_id LEFT JOIN batches b ON b.id = l.batch_id WHERE l.adjustment_id = ${id} ORDER BY l.id`);
      break;
  }

  const full = await q(sql`SELECT * FROM ${sql.raw(TABLE_OF[kind])} WHERE id = ${id}`);
  return {
    head: { ...full[0], ...head, badge: badgeFor(kind, head) } as Row & { id: number; no: string; status: string; badge: Badge },
    lines,
    related: related.map((r) => ({ ...r, id: Number(r.id) })),
    allocations,
  };
}

const TABLE_OF: Record<DocKind, string> = {
  sales_order: "sales_orders",
  sales_invoice: "sales_invoices",
  sales_return: "sales_returns",
  receipt: "receipts",
  purchase_order: "purchase_orders",
  grn: "grns",
  purchase_bill: "purchase_bills",
  supplier_payment: "supplier_payments",
  stock_transfer: "stock_transfers",
  stock_adjustment: "stock_adjustments",
};

// ───────────────────────── form data ─────────────────────────

export async function formOptions() {
  const [items, customers, suppliers, warehouses, salespersons, territories, stock] = await Promise.all([
    q<{ id: number; code: string; name: string; pcs_per_carton: number; has_batch: boolean; buy_rate: string; sell_rate: string }>(
      sql`SELECT id, code, name, pcs_per_carton, has_batch, buy_rate, sell_rate FROM items WHERE active ORDER BY name`,
    ),
    q<{ id: number; name: string; salesperson_id: number | null }>(
      sql`SELECT id, name, salesperson_id FROM customers WHERE NOT blocked ORDER BY name`,
    ),
    q<{ id: number; name: string }>(sql`SELECT id, name FROM suppliers ORDER BY name`),
    q<{ id: number; name: string; kind: string }>(sql`SELECT id, name, kind FROM warehouses WHERE active ORDER BY kind, name`),
    q<{ id: number; name: string }>(sql`SELECT id, name FROM salespersons WHERE active ORDER BY name`),
    q<{ id: number; name: string }>(sql`SELECT id, name FROM territories ORDER BY name`),
    q<{ item_id: number; warehouse_id: number; qty: number }>(sql`SELECT item_id, warehouse_id, qty FROM stock_balances WHERE qty <> 0`),
  ]);
  return {
    items: items.map((i) => ({ ...i, buy_rate: n(i.buy_rate), sell_rate: n(i.sell_rate) })),
    customers,
    suppliers,
    warehouses,
    salespersons,
    territories,
    stock,
  };
}
export type FormOptions = Awaited<ReturnType<typeof formOptions>>;

/** Lines + header to prefill a new document from its source document. */
export async function prefill(kind: DocKind, fromId: number) {
  switch (kind) {
    case "grn": {
      const [po] = await q(sql`SELECT * FROM purchase_orders WHERE id = ${fromId}`);
      if (!po) return null;
      const lines = await q(sql`SELECT id AS po_line_id, item_id, greatest(qty - received_qty, 0) AS qty, rate FROM po_lines WHERE po_id = ${fromId} ORDER BY id`);
      return { header: { supplierId: po.supplier_id, poId: po.id, warehouseId: po.warehouse_id, sourceNo: po.no }, lines };
    }
    case "purchase_bill": {
      const [g] = await q(sql`SELECT * FROM grns WHERE id = ${fromId}`);
      if (!g) return null;
      const lines = await q(sql`SELECT id AS grn_line_id, item_id, greatest(qty - billed_qty, 0) AS qty, rate FROM grn_lines WHERE grn_id = ${fromId} ORDER BY id`);
      return { header: { supplierId: g.supplier_id, grnId: g.id, sourceNo: g.no }, lines };
    }
    case "sales_invoice": {
      const [so] = await q(sql`SELECT * FROM sales_orders WHERE id = ${fromId}`);
      if (!so) return null;
      const lines = await q(sql`SELECT id AS so_line_id, item_id, greatest(qty - invoiced_qty, 0) AS qty, rate FROM so_lines WHERE so_id = ${fromId} ORDER BY id`);
      return {
        header: { customerId: so.customer_id, soId: so.id, warehouseId: so.warehouse_id, salespersonId: so.salesperson_id, sourceNo: so.no },
        lines,
      };
    }
    case "sales_return": {
      const [inv] = await q(sql`SELECT * FROM sales_invoices WHERE id = ${fromId}`);
      if (!inv) return null;
      const lines = await q(sql`SELECT id AS invoice_line_id, item_id, greatest(qty - returned_qty, 0) AS max_qty, 0 AS qty, rate FROM invoice_lines WHERE invoice_id = ${fromId} ORDER BY id`);
      return { header: { customerId: inv.customer_id, invoiceId: inv.id, warehouseId: inv.warehouse_id, sourceNo: inv.no }, lines };
    }
    case "receipt": {
      const [inv] = await q(sql`SELECT i.*, (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE against_type='sales_invoice' AND against_id=i.id) AS open
        FROM sales_invoices i WHERE id = ${fromId}`);
      if (!inv) return null;
      return { header: { customerId: inv.customer_id, invoiceId: inv.id, amount: n(inv.open), sourceNo: inv.no }, lines: [] };
    }
    case "supplier_payment": {
      const [b] = await q(sql`SELECT b.*, (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE against_type='purchase_bill' AND against_id=b.id) AS open
        FROM purchase_bills b WHERE id = ${fromId}`);
      if (!b) return null;
      return { header: { supplierId: b.supplier_id, billId: b.id, amount: n(b.open), sourceNo: b.no }, lines: [] };
    }
    default:
      return null;
  }
}
export type Prefill = NonNullable<Awaited<ReturnType<typeof prefill>>>;

// ───────────────────────── reports ─────────────────────────

export async function dashboard() {
  await connection();
  const d = today();
  const [[sales], [coll], [ar], [ap], [stock], low, overdue, topSp] = await Promise.all([
    q(sql`SELECT coalesce(sum(total),0) AS total, count(*)::int AS n FROM sales_invoices WHERE status='submitted' AND date = ${d}`),
    q(sql`SELECT coalesce(sum(amount),0) AS total FROM receipts WHERE status='submitted' AND date = ${d}`),
    q(sql`SELECT coalesce(sum(amount),0) AS total FROM party_ledger WHERE party_type='customer'`),
    q(sql`SELECT coalesce(sum(amount),0) AS total FROM party_ledger WHERE party_type='supplier'`),
    q(sql`SELECT coalesce(sum(value),0) AS total FROM stock_balances`),
    q(sql`SELECT it.id, it.name, it.pcs_per_carton, it.reorder_level, coalesce(sum(sb.qty),0)::int AS qty FROM items it
      LEFT JOIN stock_balances sb ON sb.item_id = it.id WHERE it.active AND it.reorder_level > 0
      GROUP BY it.id HAVING coalesce(sum(sb.qty),0) <= it.reorder_level ORDER BY it.name LIMIT 10`),
    q(sql`SELECT i.id, i.no, c.name AS customer, i.due_date::text, (${d}::date - i.due_date) AS days, x.open FROM sales_invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN LATERAL (SELECT sum(amount) AS open FROM party_ledger WHERE against_type='sales_invoice' AND against_id=i.id) x ON true
      WHERE i.status='submitted' AND x.open > 0 AND i.due_date < ${d} ORDER BY i.due_date LIMIT 10`),
    q(sql`SELECT sp.name, coalesce(sum(i.total),0) AS total FROM sales_invoices i JOIN salespersons sp ON sp.id = i.salesperson_id
      WHERE i.status='submitted' AND i.date >= date_trunc('month', ${d}::date) GROUP BY sp.name ORDER BY 2 DESC LIMIT 5`),
  ]);
  return {
    salesToday: n(sales.total),
    invoicesToday: Number(sales.n),
    collectedToday: n(coll.total),
    receivable: n(ar.total),
    payable: n(ap.total),
    stockValue: n(stock.total),
    low: low.map((r) => ({ id: Number(r.id), name: String(r.name), qty: Number(r.qty), ppc: Number(r.pcs_per_carton), reorder: Number(r.reorder_level) })),
    overdue: overdue.map((r) => ({ id: Number(r.id), no: String(r.no), customer: String(r.customer), days: Number(r.days), open: n(r.open) })),
    topSalespeople: topSp.map((r) => ({ name: String(r.name), total: n(r.total) })),
  };
}

export async function stockReport() {
  const rows = await q(sql`SELECT it.id, it.code, it.name, it.pcs_per_carton, it.reorder_level, w.name AS warehouse, sb.qty, sb.value, sb.valuation_rate,
      coalesce((SELECT sum(greatest(sl.qty - sl.invoiced_qty, 0)) FROM so_lines sl JOIN sales_orders so ON so.id = sl.so_id
        WHERE sl.item_id = it.id AND so.warehouse_id = sb.warehouse_id AND so.status='submitted' AND NOT so.closed), 0)::int AS ordered_by_shops
    FROM stock_balances sb JOIN items it ON it.id = sb.item_id JOIN warehouses w ON w.id = sb.warehouse_id
    WHERE sb.qty <> 0 OR EXISTS (SELECT 1 FROM so_lines sl WHERE sl.item_id = it.id)
    ORDER BY it.name, w.name`);
  const batches = await q(sql`SELECT it.name AS item, it.pcs_per_carton, w.name AS warehouse, b.batch_no, b.expiry_date::text, bb.qty,
      (b.expiry_date - ${today()}::date) AS days_left
    FROM batch_balances bb JOIN batches b ON b.id = bb.batch_id JOIN items it ON it.id = bb.item_id JOIN warehouses w ON w.id = bb.warehouse_id
    WHERE bb.qty > 0 ORDER BY b.expiry_date NULLS LAST, it.name`);
  return { rows, batches };
}

export async function stockLedgerReport(itemId?: number) {
  return q(sql`SELECT sl.id, sl.posted_at, it.name AS item, it.pcs_per_carton, w.name AS warehouse, b.batch_no, sl.qty, sl.rate, sl.value_change,
      sl.qty_after, sl.valuation_rate_after, sl.voucher_type, sl.voucher_id, sl.reverses_id
    FROM stock_ledger sl JOIN items it ON it.id = sl.item_id JOIN warehouses w ON w.id = sl.warehouse_id LEFT JOIN batches b ON b.id = sl.batch_id
    ${itemId ? sql`WHERE sl.item_id = ${itemId}` : sql``}
    ORDER BY sl.id DESC LIMIT 500`);
}

export async function arAging() {
  const d = today();
  return q(sql`
    WITH open_items AS (
      SELECT pl.party_id, pl.against_type, pl.against_id, sum(pl.amount) AS open, min(pl.due_date) AS due
      FROM party_ledger pl WHERE pl.party_type = 'customer' GROUP BY 1, 2, 3 HAVING sum(pl.amount) <> 0
    )
    SELECT c.id, c.name, t.name AS territory, sp.name AS salesperson, c.credit_limit,
      sum(oi.open) AS total,
      sum(CASE WHEN oi.due IS NULL OR oi.due >= ${d}::date THEN oi.open ELSE 0 END) AS not_due,
      sum(CASE WHEN ${d}::date - oi.due BETWEEN 1 AND 15 THEN oi.open ELSE 0 END) AS d1_15,
      sum(CASE WHEN ${d}::date - oi.due BETWEEN 16 AND 30 THEN oi.open ELSE 0 END) AS d16_30,
      sum(CASE WHEN ${d}::date - oi.due BETWEEN 31 AND 60 THEN oi.open ELSE 0 END) AS d31_60,
      sum(CASE WHEN ${d}::date - oi.due > 60 THEN oi.open ELSE 0 END) AS d60_plus
    FROM open_items oi JOIN customers c ON c.id = oi.party_id
    LEFT JOIN territories t ON t.id = c.territory_id LEFT JOIN salespersons sp ON sp.id = c.salesperson_id
    GROUP BY c.id, t.name, sp.name ORDER BY total DESC`);
}

export async function salesBySalesperson(from: string, to: string) {
  return q(sql`
    SELECT coalesce(sp.name, '(none)') AS salesperson, count(DISTINCT i.id)::int AS invoices, count(DISTINCT i.customer_id)::int AS shops,
      sum(i.total) AS sales, sum(i.cost) AS cost, sum(i.total) - sum(i.cost) AS margin,
      coalesce((SELECT sum(r.total) FROM sales_returns r JOIN sales_invoices ii ON ii.id = r.invoice_id
        WHERE r.status='submitted' AND r.date BETWEEN ${from}::date AND ${to}::date AND ii.salesperson_id IS NOT DISTINCT FROM i.salesperson_id), 0) AS returns,
      coalesce((SELECT sum(rc.amount) FROM receipts rc WHERE rc.status='submitted' AND rc.date BETWEEN ${from}::date AND ${to}::date
        AND rc.salesperson_id IS NOT DISTINCT FROM i.salesperson_id), 0) AS collected
    FROM sales_invoices i LEFT JOIN salespersons sp ON sp.id = i.salesperson_id
    WHERE i.status='submitted' AND i.date BETWEEN ${from}::date AND ${to}::date
    GROUP BY i.salesperson_id, sp.name ORDER BY sales DESC`);
}

export async function customerStatement(customerId: number) {
  await connection();
  const [cust] = await q(sql`SELECT c.*, t.name AS territory, sp.name AS salesperson FROM customers c
    LEFT JOIN territories t ON t.id = c.territory_id LEFT JOIN salespersons sp ON sp.id = c.salesperson_id WHERE c.id = ${customerId}`);
  if (!cust) return null;
  const entries = await q(sql`
    SELECT pl.id, pl.date::text, pl.voucher_type, pl.voucher_id, pl.amount, pl.reverses_id,
      CASE pl.voucher_type WHEN 'sales_invoice' THEN (SELECT no FROM sales_invoices WHERE id = pl.voucher_id)
        WHEN 'receipt' THEN (SELECT no FROM receipts WHERE id = pl.voucher_id)
        WHEN 'sales_return' THEN (SELECT no FROM sales_returns WHERE id = pl.voucher_id) END AS voucher_no,
      sum(pl.amount) OVER (ORDER BY pl.id) AS running
    FROM party_ledger pl WHERE pl.party_type = 'customer' AND pl.party_id = ${customerId} ORDER BY pl.id`);
  const credit = await creditStatus(db, customerId);
  return { customer: cust, entries, credit };
}

export async function mastersList(kind: string) {
  switch (kind) {
    case "customers":
      return q(sql`SELECT c.*, t.name AS territory, sp.name AS salesperson,
          (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE party_type='customer' AND party_id=c.id) AS balance
        FROM customers c LEFT JOIN territories t ON t.id = c.territory_id LEFT JOIN salespersons sp ON sp.id = c.salesperson_id ORDER BY c.name`);
    case "items":
      return q(sql`SELECT it.*, coalesce((SELECT sum(qty) FROM stock_balances WHERE item_id = it.id),0)::int AS stock FROM items it ORDER BY it.name`);
    case "suppliers":
      return q(sql`SELECT s.*, (SELECT coalesce(sum(amount),0) FROM party_ledger WHERE party_type='supplier' AND party_id=s.id) AS balance
        FROM suppliers s ORDER BY s.name`);
    case "warehouses":
      return q(sql`SELECT w.*, coalesce((SELECT sum(value) FROM stock_balances WHERE warehouse_id = w.id),0) AS stock_value FROM warehouses w ORDER BY w.kind, w.name`);
    case "salespersons":
      return q(sql`SELECT * FROM salespersons ORDER BY name`);
    case "territories":
      return q(sql`SELECT t.*, p.name AS parent FROM territories t LEFT JOIN territories p ON p.id = t.parent_id ORDER BY t.name`);
    default:
      return [];
  }
}
