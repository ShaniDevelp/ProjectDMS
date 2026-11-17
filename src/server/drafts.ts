import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  grns,
  purchaseBills,
  purchaseOrders,
  receipts,
  salesInvoices,
  salesOrders,
  salesReturns,
  stockAdjustments,
  stockTransfers,
  supplierPayments,
} from "@/db/schema";
import { DomainError } from "./util";

const TABLES = {
  purchase_order: purchaseOrders,
  grn: grns,
  purchase_bill: purchaseBills,
  supplier_payment: supplierPayments,
  sales_order: salesOrders,
  sales_invoice: salesInvoices,
  sales_return: salesReturns,
  receipt: receipts,
  stock_transfer: stockTransfers,
  stock_adjustment: stockAdjustments,
} as const;

export type DocKind = keyof typeof TABLES;

/** Drafts have no ledger effect, so they can simply be deleted (lines cascade). */
export async function deleteDraft(kind: DocKind, id: number) {
  const t = TABLES[kind];
  const res = await db.delete(t).where(and(eq(t.id, id), eq(t.status, "draft"))).returning({ id: t.id });
  if (!res.length) throw new DomainError("Only drafts can be deleted");
}
