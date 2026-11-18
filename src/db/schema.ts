import {
  pgTable,
  serial,
  bigserial,
  integer,
  bigint,
  text,
  boolean,
  numeric,
  date,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// numeric columns come back as strings; services convert with toNum().
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 14, scale: 4 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Shared columns for every submittable document. */
const docCols = () => ({
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  status: text("status", { enum: ["draft", "submitted", "cancelled"] }).notNull().default("draft"),
  date: date("date", { mode: "string" }).notNull(),
  remarks: text("remarks"),
  createdAt: createdAt(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

// ───────────────────────── masters ─────────────────────────

export const docCounters = pgTable(
  "doc_counters",
  {
    series: text("series").notNull(),
    year: integer("year").notNull(),
    last: integer("last").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.series, t.year] })],
);

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  pcsPerCarton: integer("pcs_per_carton").notNull().default(1),
  hasBatch: boolean("has_batch").notNull().default(false),
  /** Default rates are per PIECE. */
  buyRate: rate("buy_rate").notNull().default("0"),
  sellRate: rate("sell_rate").notNull().default("0"),
  reorderLevel: integer("reorder_level").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull().references(() => items.id),
    batchNo: text("batch_no").notNull(),
    expiryDate: date("expiry_date", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("batches_item_batch_uq").on(t.itemId, t.batchNo)],
);

export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: ["godown", "van"] }).notNull().default("godown"),
  active: boolean("active").notNull().default(true),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  address: text("address"),
  createdAt: createdAt(),
});

export const territories = pgTable("territories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentId: integer("parent_id"),
});

export const salespersons = pgTable("salespersons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ownerName: text("owner_name"),
  phone: text("phone"),
  address: text("address"),
  territoryId: integer("territory_id").references(() => territories.id),
  salespersonId: integer("salesperson_id").references(() => salespersons.id),
  /** null = unlimited, 0 = cash only. */
  creditLimit: money("credit_limit"),
  /** Invoice due date = invoice date + creditDays. */
  creditDays: integer("credit_days").notNull().default(0),
  /** Lets this customer's documents pass the credit check (v1 stand-in for a Credit Controller role). */
  creditOverride: boolean("credit_override").notNull().default(false),
  blocked: boolean("blocked").notNull().default(false),
  createdAt: createdAt(),
});

// ───────────────────────── procurement ─────────────────────────

export const purchaseOrders = pgTable("purchase_orders", {
  ...docCols(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  closed: boolean("closed").notNull().default(false),
  total: money("total").notNull().default("0"),
});

export const poLines = pgTable("po_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
  /** SUM of submitted GRN line qty (accepted). */
  receivedQty: integer("received_qty").notNull().default(0),
});

export const grns = pgTable("grns", {
  ...docCols(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  poId: integer("po_id").references(() => purchaseOrders.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  supplierRef: text("supplier_ref"),
  total: money("total").notNull().default("0"),
});

export const grnLines = pgTable("grn_lines", {
  id: serial("id").primaryKey(),
  grnId: integer("grn_id").notNull().references(() => grns.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id").references(() => poLines.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rejectedQty: integer("rejected_qty").notNull().default(0),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
  batchNo: text("batch_no"),
  expiryDate: date("expiry_date", { mode: "string" }),
  batchId: integer("batch_id").references(() => batches.id),
  /** SUM of submitted purchase-bill line qty. */
  billedQty: integer("billed_qty").notNull().default(0),
});

export const purchaseBills = pgTable("purchase_bills", {
  ...docCols(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  grnId: integer("grn_id").references(() => grns.id),
  supplierBillNo: text("supplier_bill_no"),
  dueDate: date("due_date", { mode: "string" }),
  total: money("total").notNull().default("0"),
});

export const billLines = pgTable("bill_lines", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => purchaseBills.id, { onDelete: "cascade" }),
  grnLineId: integer("grn_line_id").notNull().references(() => grnLines.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
});

export const supplierPayments = pgTable("supplier_payments", {
  ...docCols(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  amount: money("amount").notNull(),
  method: text("method", { enum: ["cash", "bank", "cheque"] }).notNull().default("cash"),
  reference: text("reference"),
});

export const supplierPaymentAllocations = pgTable("supplier_payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => supplierPayments.id, { onDelete: "cascade" }),
  billId: integer("bill_id").notNull().references(() => purchaseBills.id),
  amount: money("amount").notNull(),
});

// ───────────────────────── selling ─────────────────────────

export const salesOrders = pgTable("sales_orders", {
  ...docCols(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  salespersonId: integer("salesperson_id").references(() => salespersons.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  closed: boolean("closed").notNull().default(false),
  total: money("total").notNull().default("0"),
});

export const soLines = pgTable("so_lines", {
  id: serial("id").primaryKey(),
  soId: integer("so_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
  /** SUM of submitted invoice line qty. */
  invoicedQty: integer("invoiced_qty").notNull().default(0),
});

export const salesInvoices = pgTable("sales_invoices", {
  ...docCols(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  soId: integer("so_id").references(() => salesOrders.id),
  salespersonId: integer("salesperson_id").references(() => salespersons.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  dueDate: date("due_date", { mode: "string" }),
  total: money("total").notNull().default("0"),
  /** Cost of goods delivered (from stock ledger). */
  cost: money("cost").notNull().default("0"),
});

export const invoiceLines = pgTable("invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoices.id, { onDelete: "cascade" }),
  soLineId: integer("so_line_id").references(() => soLines.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
  /** SUM of submitted return line qty. */
  returnedQty: integer("returned_qty").notNull().default(0),
});

/** Which batches (FEFO) an invoice line was delivered from, and at what cost. */
export const invoiceLineAllocations = pgTable("invoice_line_allocations", {
  id: serial("id").primaryKey(),
  invoiceLineId: integer("invoice_line_id").notNull().references(() => invoiceLines.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => batches.id),
  qty: integer("qty").notNull(),
  costRate: rate("cost_rate").notNull(),
});

export const salesReturns = pgTable("sales_returns", {
  ...docCols(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoices.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  reason: text("reason", { enum: ["unsold", "damaged", "expired", "wrong_item", "other"] }).notNull().default("unsold"),
  total: money("total").notNull().default("0"),
});

export const returnLines = pgTable("return_lines", {
  id: serial("id").primaryKey(),
  returnId: integer("return_id").notNull().references(() => salesReturns.id, { onDelete: "cascade" }),
  invoiceLineId: integer("invoice_line_id").notNull().references(() => invoiceLines.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  qty: integer("qty").notNull(),
  rate: rate("rate").notNull(),
  amount: money("amount").notNull(),
  /** good = back to sellable stock; damaged = credit the customer, no stock. */
  condition: text("condition", { enum: ["good", "damaged"] }).notNull().default("good"),
});

export const receipts = pgTable("receipts", {
  ...docCols(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  salespersonId: integer("salesperson_id").references(() => salespersons.id),
  amount: money("amount").notNull(),
  method: text("method", { enum: ["cash", "bank", "cheque"] }).notNull().default("cash"),
  reference: text("reference"),
});

export const receiptAllocations = pgTable("receipt_allocations", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").notNull().references(() => salesInvoices.id),
  amount: money("amount").notNull(),
});

// ───────────────────────── inventory documents ─────────────────────────

export const stockTransfers = pgTable("stock_transfers", {
  ...docCols(),
  fromWarehouseId: integer("from_warehouse_id").notNull().references(() => warehouses.id),
  toWarehouseId: integer("to_warehouse_id").notNull().references(() => warehouses.id),
});

export const transferLines = pgTable("transfer_lines", {
  id: serial("id").primaryKey(),
  transferId: integer("transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  batchId: integer("batch_id").references(() => batches.id),
  qty: integer("qty").notNull(),
});

export const stockAdjustments = pgTable("stock_adjustments", {
  ...docCols(),
  warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
  reason: text("reason", { enum: ["count", "damage", "expiry", "opening", "other"] }).notNull().default("count"),
});

export const adjustmentLines = pgTable("adjustment_lines", {
  id: serial("id").primaryKey(),
  adjustmentId: integer("adjustment_id").notNull().references(() => stockAdjustments.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => items.id),
  batchId: integer("batch_id").references(() => batches.id),
  batchNo: text("batch_no"),
  expiryDate: date("expiry_date", { mode: "string" }),
  /** Signed: +found/opening, −loss. */
  qtyChange: integer("qty_change").notNull(),
  /** Rate for positive changes (per piece); losses go out at valuation rate. */
  rate: rate("rate").notNull().default("0"),
});

// ───────────────────────── ledgers ─────────────────────────

export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    itemId: integer("item_id").notNull().references(() => items.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    batchId: integer("batch_id").references(() => batches.id),
    /** Signed pieces: + in, − out. */
    qty: integer("qty").notNull(),
    /** Incoming rate for inward rows, valuation rate used for outward rows. */
    rate: rate("rate").notNull(),
    valueChange: money("value_change").notNull(),
    /** Item × warehouse running state after this row. */
    qtyAfter: integer("qty_after").notNull(),
    valuationRateAfter: rate("valuation_rate_after").notNull(),
    voucherType: text("voucher_type").notNull(),
    voucherId: integer("voucher_id").notNull(),
    voucherLineId: integer("voucher_line_id"),
    reversesId: bigint("reverses_id", { mode: "number" }),
  },
  (t) => [
    index("stock_ledger_item_wh_idx").on(t.itemId, t.warehouseId, t.id),
    index("stock_ledger_voucher_idx").on(t.voucherType, t.voucherId),
  ],
);

/** Cache of item × warehouse balance; updated in the same tx as stock_ledger. */
export const stockBalances = pgTable(
  "stock_balances",
  {
    itemId: integer("item_id").notNull().references(() => items.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    qty: integer("qty").notNull().default(0),
    value: money("value").notNull().default("0"),
    valuationRate: rate("valuation_rate").notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.warehouseId] })],
);

/** Batch qty per warehouse. batch_id 0 is not used; non-batch items have no rows here. */
export const batchBalances = pgTable(
  "batch_balances",
  {
    itemId: integer("item_id").notNull().references(() => items.id),
    warehouseId: integer("warehouse_id").notNull().references(() => warehouses.id),
    batchId: integer("batch_id").notNull().references(() => batches.id),
    qty: integer("qty").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.warehouseId, t.batchId] })],
);

/**
 * AR/AP open-item ledger. amount > 0 = party owes more (customer owes us / we owe supplier).
 * An invoice's outstanding = SUM(amount) WHERE against = that invoice.
 */
export const partyLedger = pgTable(
  "party_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    date: date("date", { mode: "string" }).notNull(),
    partyType: text("party_type", { enum: ["customer", "supplier"] }).notNull(),
    partyId: integer("party_id").notNull(),
    amount: money("amount").notNull(),
    voucherType: text("voucher_type").notNull(),
    voucherId: integer("voucher_id").notNull(),
    againstType: text("against_type").notNull(),
    againstId: integer("against_id").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    reversesId: bigint("reverses_id", { mode: "number" }),
  },
  (t) => [
    index("party_ledger_party_idx").on(t.partyType, t.partyId),
    index("party_ledger_against_idx").on(t.againstType, t.againstId),
    index("party_ledger_voucher_idx").on(t.voucherType, t.voucherId),
  ],
);

// ───────────────────────── attachments ─────────────────────────

/** Proof files (payment slips, cheque photos, PDFs) attached to any document. Max 10 MB each. */
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    docKind: text("doc_kind").notNull(),
    docId: integer("doc_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_doc_idx").on(t.docKind, t.docId)],
);
