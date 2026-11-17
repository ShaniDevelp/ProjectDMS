import { sql } from "drizzle-orm";
import type { Tx } from "@/db";

export const SERIES = {
  purchaseOrder: "PO",
  grn: "GRN",
  purchaseBill: "PB",
  supplierPayment: "SP",
  salesOrder: "SO",
  salesInvoice: "SI",
  salesReturn: "SR",
  receipt: "RC",
  stockTransfer: "ST",
  stockAdjustment: "SA",
} as const;

/** Atomic per-series, per-year counter: PO-2026-00001. */
export async function nextNo(tx: Tx, series: string, isoDate: string): Promise<string> {
  const year = Number(isoDate.slice(0, 4));
  const res = await tx.execute<{ last: number }>(sql`
    INSERT INTO doc_counters (series, year, last) VALUES (${series}, ${year}, 1)
    ON CONFLICT (series, year) DO UPDATE SET last = doc_counters.last + 1
    RETURNING last`);
  const last = res.rows[0].last;
  return `${series}-${year}-${String(last).padStart(5, "0")}`;
}
