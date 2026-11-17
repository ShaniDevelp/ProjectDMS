# DMS v1: Design

The core order-to-cash flow for a Pakistani FMCG distributor.
Stack: Next.js 16 (App Router, Server Actions), Postgres 16, Drizzle ORM, Vitest.

> We studied ERPNext (GPL-3) for its **concepts only**. No ERPNext code is copied. See `docs/ERPNEXT_STUDY.md`.

## Scope (v1)

| Module | In v1 |
|---|---|
| Master data | Items (piece + carton UOM, batch/expiry flag), warehouses (godown/van), suppliers, territories, salespeople, customers (credit limit + credit days) |
| Procurement | Purchase Order → Goods Receipt (accepted + rejected qty) → Purchase Bill → Supplier Payment |
| Inventory | Append-only stock ledger, moving-average valuation, batches + FEFO, stock transfer, stock adjustment |
| Selling | Sales Order (credit check) → Sales Invoice (delivers stock + bills, partial allowed) → Sales Return |
| Collections | Customer receipts with oldest-first auto allocation, AR ledger, aging |
| Reports | Dashboard, stock balance, AR aging, sales by salesperson, customer statement |

Not in v1: auth/roles UI (a single admin user), the field mobile app, route planning, delivery trips, schemes, a full general ledger (GL), and tax.

## Core rules (taken from the study)

1. **Document lifecycle.** A document is `draft` (editable, no ledger effect), then `submitted` (immutable, ledgers posted), then `cancelled` (ledger effect reversed with mirror rows). Cancel is blocked if any downstream document is still submitted.
2. **Row-level links.** Every downstream line stores the id of its upstream line: `grn_line.po_line_id`, `bill_line.grn_line_id`, `invoice_line.so_line_id`, `return_line.invoice_line_id`.
3. **Progress counters are recomputed by SUM, never incremented.** For example, `po_lines.received_qty` is the sum of qty over submitted GRN lines. This happens in the same database transaction as the submit or cancel, so cancelling is always safe.
4. **Status is derived** from the percentages plus a manual `closed` flag.
5. **The stock ledger is append-only.** One row = one item × warehouse × batch, changed by one line of one voucher. Qty is in base units (pieces). Each row stores the running qty and moving-average rate after it posts. `stock_balances` is a cache, updated in the same transaction.
6. **No back-dated stock postings in v1.** Posting time is now. This removes ERPNext's whole repost engine.
7. **Batches.** The batch id sits on the ledger row. Sales allocate FEFO (first expiry, first out) automatically. Expired batches cannot be sold.
8. **Party ledger (AR/AP).** This is an open-item sub-ledger with signed amounts. Each row has an `against_doc`. An invoice's outstanding amount = SUM over its rows. Receipts allocate to invoices, and any unallocated amount sits as an advance row against the receipt itself.
9. **Credit check** on SO submit and on invoice submit. Exposure = AR balance + unbilled open SO value. It blocks if exposure is over `credit_limit`, or if any invoice is overdue by more than `credit_days`. Each customer has a `credit_override` flag for now; a role comes later.
10. **Money** is `numeric(14,2)` and **rates** are `numeric(14,4)`, both computed in TS with explicit rounding. **Qty** is an integer in pieces. Cartons are entered in the UI and converted using `items.pcs_per_carton`.
11. **Numbering** is `PO-2026-00001` style, from a `doc_counters` table updated with a row lock.
