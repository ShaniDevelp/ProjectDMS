CREATE TABLE "adjustment_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"adjustment_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"batch_id" integer,
	"batch_no" text,
	"expiry_date" date,
	"qty_change" integer NOT NULL,
	"rate" numeric(14, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_balances" (
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "batch_balances_item_id_warehouse_id_batch_id_pk" PRIMARY KEY("item_id","warehouse_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"grn_line_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_name" text,
	"phone" text,
	"address" text,
	"territory_id" integer,
	"salesperson_id" integer,
	"credit_limit" numeric(14, 2),
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_override" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "doc_counters" (
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_counters_series_year_pk" PRIMARY KEY("series","year")
);
--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"grn_id" integer NOT NULL,
	"po_line_id" integer,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rejected_qty" integer DEFAULT 0 NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"batch_no" text,
	"expiry_date" date,
	"batch_id" integer,
	"billed_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grns" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"supplier_id" integer NOT NULL,
	"po_id" integer,
	"warehouse_id" integer NOT NULL,
	"supplier_ref" text,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "grns_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_line_id" integer NOT NULL,
	"batch_id" integer,
	"qty" integer NOT NULL,
	"cost_rate" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"so_line_id" integer,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pcs_per_carton" integer DEFAULT 1 NOT NULL,
	"has_batch" boolean DEFAULT false NOT NULL,
	"buy_rate" numeric(14, 4) DEFAULT '0' NOT NULL,
	"sell_rate" numeric(14, 4) DEFAULT '0' NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "party_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"party_type" text NOT NULL,
	"party_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_id" integer NOT NULL,
	"against_type" text NOT NULL,
	"against_id" integer NOT NULL,
	"due_date" date,
	"reverses_id" bigint
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"supplier_id" integer NOT NULL,
	"grn_id" integer,
	"supplier_bill_no" text,
	"due_date" date,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_bills_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"supplier_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_orders_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"customer_id" integer NOT NULL,
	"salesperson_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	CONSTRAINT "receipts_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"invoice_line_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"condition" text DEFAULT 'good' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"customer_id" integer NOT NULL,
	"so_id" integer,
	"salesperson_id" integer,
	"warehouse_id" integer NOT NULL,
	"due_date" date,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_invoices_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"customer_id" integer NOT NULL,
	"salesperson_id" integer,
	"warehouse_id" integer NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_orders_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"customer_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"reason" text DEFAULT 'unsold' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_returns_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "salespersons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "salespersons_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "so_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"so_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"invoiced_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"warehouse_id" integer NOT NULL,
	"reason" text DEFAULT 'count' NOT NULL,
	CONSTRAINT "stock_adjustments_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valuation_rate" numeric(14, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "stock_balances_item_id_warehouse_id_pk" PRIMARY KEY("item_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"batch_id" integer,
	"qty" integer NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"value_change" numeric(14, 2) NOT NULL,
	"qty_after" integer NOT NULL,
	"valuation_rate_after" numeric(14, 4) NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_id" integer NOT NULL,
	"voucher_line_id" integer,
	"reverses_id" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer NOT NULL,
	CONSTRAINT "stock_transfers_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"supplier_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	CONSTRAINT "supplier_payments_no_unique" UNIQUE("no")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	CONSTRAINT "territories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "transfer_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"batch_id" integer,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'godown' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "warehouses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_balances" ADD CONSTRAINT "batch_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_balances" ADD CONSTRAINT "batch_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_balances" ADD CONSTRAINT "batch_balances_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_purchase_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_grn_line_id_grn_lines_id_fk" FOREIGN KEY ("grn_line_id") REFERENCES "public"."grn_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_allocations" ADD CONSTRAINT "invoice_line_allocations_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_allocations" ADD CONSTRAINT "invoice_line_allocations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_so_line_id_so_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."so_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "so_lines" ADD CONSTRAINT "so_lines_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "so_lines" ADD CONSTRAINT "so_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_bill_id_purchase_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."purchase_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_item_batch_uq" ON "batches" USING btree ("item_id","batch_no");--> statement-breakpoint
CREATE INDEX "party_ledger_party_idx" ON "party_ledger" USING btree ("party_type","party_id");--> statement-breakpoint
CREATE INDEX "party_ledger_against_idx" ON "party_ledger" USING btree ("against_type","against_id");--> statement-breakpoint
CREATE INDEX "party_ledger_voucher_idx" ON "party_ledger" USING btree ("voucher_type","voucher_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_wh_idx" ON "stock_ledger" USING btree ("item_id","warehouse_id","id");--> statement-breakpoint
CREATE INDEX "stock_ledger_voucher_idx" ON "stock_ledger" USING btree ("voucher_type","voucher_id");