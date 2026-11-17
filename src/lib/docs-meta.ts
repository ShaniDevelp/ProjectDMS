/** Shared (client + server) metadata for every document type. */
export const DOC_KINDS = [
  "sales_order",
  "sales_invoice",
  "sales_return",
  "receipt",
  "purchase_order",
  "grn",
  "purchase_bill",
  "supplier_payment",
  "stock_transfer",
  "stock_adjustment",
] as const;

export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_META: Record<DocKind, { title: string; plural: string; party: "customer" | "supplier" | null; blurb: string }> = {
  sales_order: { title: "Sales Order", plural: "Sales Orders", party: "customer", blurb: "Booked by the salesman at the shop. Credit is checked on confirm." },
  sales_invoice: { title: "Sales Invoice", plural: "Sales Invoices", party: "customer", blurb: "Goods leave the warehouse and the shop owes money." },
  sales_return: { title: "Sales Return", plural: "Sales Returns", party: "customer", blurb: "Shop sends goods back; credit reduces what they owe." },
  receipt: { title: "Receipt", plural: "Receipts", party: "customer", blurb: "Cash/cheque collected from a shop." },
  purchase_order: { title: "Purchase Order", plural: "Purchase Orders", party: "supplier", blurb: "What you asked the company to send." },
  grn: { title: "Goods Receipt", plural: "Goods Receipts", party: "supplier", blurb: "What actually arrived at the godown." },
  purchase_bill: { title: "Purchase Bill", plural: "Purchase Bills", party: "supplier", blurb: "The supplier's invoice: what you owe them." },
  supplier_payment: { title: "Supplier Payment", plural: "Supplier Payments", party: "supplier", blurb: "Money paid to a supplier." },
  stock_transfer: { title: "Stock Transfer", plural: "Stock Transfers", party: null, blurb: "Move stock between godown and vans." },
  stock_adjustment: { title: "Stock Adjustment", plural: "Stock Adjustments", party: null, blurb: "Physical count, damage, expiry, opening stock." },
};

export const isDocKind = (k: string): k is DocKind => (DOC_KINDS as readonly string[]).includes(k);

export const docHref = (kind: DocKind, id?: number | string) => (id ? `/docs/${kind}/${id}` : `/docs/${kind}`);

export const MASTER_KINDS = ["customers", "items", "suppliers", "warehouses", "salespersons", "territories"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];
export const isMasterKind = (k: string): k is MasterKind => (MASTER_KINDS as readonly string[]).includes(k);

export const MASTER_TITLES: Record<MasterKind, string> = {
  customers: "Customers (Shops)",
  items: "Items",
  suppliers: "Suppliers",
  warehouses: "Warehouses & Vans",
  salespersons: "Salespeople",
  territories: "Territories / Areas",
};

/** "2 ctn + 3 pcs" style display. */
export function fmtQty(qty: number, pcsPerCarton: number) {
  if (pcsPerCarton <= 1) return `${qty} pcs`;
  const sign = qty < 0 ? "-" : "";
  const a = Math.abs(qty);
  const c = Math.floor(a / pcsPerCarton);
  const p = a % pcsPerCarton;
  if (!c) return `${sign}${p} pcs`;
  return p ? `${sign}${c} ctn + ${p} pcs` : `${sign}${c} ctn`;
}

export function fmtMoney(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return `Rs ${v.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
