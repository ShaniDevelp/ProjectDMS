# ERPNext v16: what we learned and what we kept

We studied the source in `C:\PersonalProjects\erpnext-src` for concepts only. ERPNext is GPL-3, and none of its code is copied here.

## Kept (same idea, simpler implementation)

| ERPNext concept | Where in ERPNext | Our version |
|---|---|---|
| Append-only Stock Ledger Entry with running qty/value per row | `stock/stock_ledger.py`, `stock_ledger_entry` | `stock_ledger` table, `src/server/stock.ts` `move()` |
| Bin = cached balance per item × warehouse | `stock/doctype/bin` | `stock_balances` (qty, value, rate), `batch_balances` |
| docstatus draft / submitted / cancelled | Frappe core | `status` column on every document |
| Row-level upstream links (`so_detail`, `po_detail`) | every child doctype | `so_line_id`, `po_line_id`, `grn_line_id`, `invoice_line_id` |
| Progress recomputed by SUM via the status updater | `controllers/status_updater.py` | `recompute*()` functions in purchasing/selling |
| Status derived from per_received / per_billed / per_delivered | `status_updater.py` status map | `badgeFor()` in `src/server/queries.ts` |
| Payment Ledger Entry (signed AR/AP open items) | `accounts/utils.py`, `payment_ledger_entry` | `party_ledger`, `src/server/party.ts` |
| Credit limit = GL balance + unbilled SO, with Credit Controller bypass | `selling/doctype/customer/customer.py` | `enforceCredit()`, `credit_override` flag |
| Over-receipt / over-billing check | `check_overflow_with_allowance` | Hard block (0% allowance) |
| Closing a short-received PO / SO | Close status | `closed` flag |
| Returns capped at the original qty and costed at the original rate | `controllers/sales_and_purchase_return.py` | `submitSalesReturn()` using `invoice_line_allocations` |
| FEFO batch picking, expired batches blocked | `serial_and_batch_bundle.py`, Stock Settings | `allocateFefo()` |

## Cut (overkill for a small distributor)

- FIFO/LIFO queues. We use moving average only.
- Background repost engine for back-dated entries. v1 posts at the current time.
- Serial & Batch Bundle documents. We put `batch_id` directly on the ledger row.
- Multi-currency (PKR only), finance books, accounting dimensions.
- Generic status-updater metadata engine. We write explicit SQL per link.
- Pick List and hard stock reservation.
- Multi-term payment schedules. We use one `credit_days` per customer.
- Commission % split across sales teams. We use one salesperson per document.
- Dunning interest and fees. Overdue blocking and the aging report cover it.
- Full double-entry GL. Deferred to v2. The party ledger and stock ledger hold the numbers.

## FMCG gaps in ERPNext worth building next

- Route and beat-day planning per salesperson. ERPNext has no concept for this.
- Van trip settlement: what each van loaded, sold and returned, and the cash it brought back.
- Trade schemes, e.g. "10 + 1 free" and carton discounts.
- A simple salesman mobile app: route → shop → last order + balance → qty → confirm.
