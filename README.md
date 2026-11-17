# DMS: Distribution Management System (v1)

A web app for a Pakistani FMCG distributor. It covers the core flow from buying stock to collecting payments:

- **Buying:** Purchase Order → Goods Receipt (GRN) → Purchase Bill → Supplier Payment
- **Selling:** Sales Order (credit-checked) → Sales Invoice (delivers stock + bills) → Sales Return → Receipt
- **Stock:** append-only stock ledger, moving-average cost, batches with first-expiry-first-out (FEFO), van loading (transfers), adjustments
- **Reports:** dashboard, stock balance + expiry, stock ledger, receivables aging, sales by salesperson, customer statement (khata)

Design: [docs/DESIGN.md](docs/DESIGN.md). ERPNext concepts studied: [docs/ERPNEXT_STUDY.md](docs/ERPNEXT_STUDY.md).

## Run locally

Prerequisites: Node 20+, Docker Desktop running.

```bash
cp .env.example .env     # first time only
npm install
npm run db:up            # Postgres 16 on localhost:5434 (dbs: dms, dms_test)
npm run db:migrate       # create tables in dms
npm run db:migrate:test  # create tables in dms_test (for tests)
npm run db:seed          # optional: demo distributor data (WIPES dms)
npx next dev -p 3100     # http://localhost:3100
```

## Checks

```bash
npm run typecheck
npm run lint
npm test                 # integration tests against dms_test (real Postgres)
```

## How it works (short)

- **Every document** is draft → submitted (posts to the ledgers) → cancelled (adds reverse rows). Ledger rows are never edited or deleted.
- **Stock ledger:** one row per item × warehouse × batch movement. Each row stores the running qty and average cost after it posts. `stock_balances` is a cache updated in the same transaction.
- **Party ledger:** signed open items for receivables and payables. What is still owed on an invoice = SUM of its rows. Receipts settle the oldest due bill first, and any extra stays on the account as an advance.
- **Progress counters** (`received_qty`, `invoiced_qty`, `billed_qty`, `returned_qty`) are always recomputed with SUM in the same transaction, never incremented.
- **Credit control:** a sales order is blocked when the shop is over its credit limit (what it owes + undelivered orders), or when it has any overdue bill.
- **Qty** is stored in pieces. The UI takes cartons + pieces, using `items.pcs_per_carton`.

## Not in v1

Login/roles, the salesman mobile app, route/beat planning, delivery trips with cash settlement, trade schemes, full general ledger and tax (FBR), Urdu UI.
