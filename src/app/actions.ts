"use server";

import { ZodError } from "zod";
import type { DocKind, MasterKind } from "@/lib/docs-meta";
import { deleteDraft } from "@/server/drafts";
import * as inv from "@/server/inventory";
import * as masters from "@/server/masters";
import * as pur from "@/server/purchasing";
import * as sel from "@/server/selling";
import { DomainError } from "@/server/util";

/** On failure, `id` is set when a draft was saved but could not be submitted. */
export type ActionResult = { ok: true; id?: number } | { ok: false; error: string; id?: number };

function toError(e: unknown): ActionResult {
  if (e instanceof DomainError) return { ok: false, error: e.message };
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return { ok: false, error: `${i.path.join(".") || "Input"}: ${i.message}` };
  }
  // Drizzle wraps pg errors; the Postgres code lives on `cause`.
  const pgCode = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  if (pgCode === "23505") return { ok: false, error: "That name or code already exists" };
  console.error(e);
  return { ok: false, error: "Something went wrong. Check the server log." };
}

const CREATE: Record<DocKind, (input: unknown) => Promise<{ id: number }>> = {
  purchase_order: pur.createPurchaseOrder,
  grn: pur.createGrn,
  purchase_bill: pur.createPurchaseBill,
  supplier_payment: pur.createSupplierPayment,
  sales_order: sel.createSalesOrder,
  sales_invoice: sel.createSalesInvoice,
  sales_return: sel.createSalesReturn,
  receipt: sel.createReceipt,
  stock_transfer: inv.createStockTransfer,
  stock_adjustment: inv.createStockAdjustment,
};

const SUBMIT: Record<DocKind, (id: number) => Promise<void>> = {
  purchase_order: pur.submitPurchaseOrder,
  grn: pur.submitGrn,
  purchase_bill: pur.submitPurchaseBill,
  supplier_payment: pur.submitSupplierPayment,
  sales_order: sel.submitSalesOrder,
  sales_invoice: sel.submitSalesInvoice,
  sales_return: sel.submitSalesReturn,
  receipt: sel.submitReceipt,
  stock_transfer: inv.submitStockTransfer,
  stock_adjustment: inv.submitStockAdjustment,
};

const CANCEL: Record<DocKind, (id: number) => Promise<void>> = {
  purchase_order: pur.cancelPurchaseOrder,
  grn: pur.cancelGrn,
  purchase_bill: pur.cancelPurchaseBill,
  supplier_payment: pur.cancelSupplierPayment,
  sales_order: sel.cancelSalesOrder,
  sales_invoice: sel.cancelSalesInvoice,
  sales_return: sel.cancelSalesReturn,
  receipt: sel.cancelReceipt,
  stock_transfer: inv.cancelStockTransfer,
  stock_adjustment: inv.cancelStockAdjustment,
};

/** Create a draft, and optionally submit it straight away. */
export async function createDocAction(kind: DocKind, input: unknown, submit: boolean): Promise<ActionResult> {
  let id: number | undefined;
  try {
    id = (await CREATE[kind](input)).id;
    if (submit) await SUBMIT[kind](id);
    return { ok: true, id };
  } catch (e) {
    const res = toError(e);
    // The draft was saved even though submit failed: send the user to it with the reason.
    if (id && !res.ok) return { ok: false, error: `Saved as draft, but could not submit: ${res.error}`, id };
    return res;
  }
}

export async function docAction(kind: DocKind, id: number, action: "submit" | "cancel" | "delete" | "close" | "reopen"): Promise<ActionResult> {
  try {
    if (action === "submit") await SUBMIT[kind](id);
    else if (action === "cancel") await CANCEL[kind](id);
    else if (action === "delete") await deleteDraft(kind, id);
    else if (kind === "purchase_order") await pur.setPurchaseOrderClosed(id, action === "close");
    else if (kind === "sales_order") await sel.setSalesOrderClosed(id, action === "close");
    else return { ok: false, error: "Not supported" };
    return { ok: true, id };
  } catch (e) {
    return toError(e);
  }
}

const SAVE: Record<MasterKind, (input: unknown, id?: number) => Promise<unknown>> = {
  customers: masters.saveCustomer,
  items: masters.saveItem,
  suppliers: masters.saveSupplier,
  warehouses: masters.saveWarehouse,
  salespersons: masters.saveSalesperson,
  territories: masters.saveTerritory,
};

export async function saveMasterAction(
  kind: MasterKind,
  input: unknown,
  id?: number,
): Promise<{ ok: true; id?: number; row?: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const row = (await SAVE[kind](input, id)) as Record<string, unknown> | undefined;
    return { ok: true, id: row ? Number(row.id) : undefined, row: row ? JSON.parse(JSON.stringify(row)) : undefined };
  } catch (e) {
    const res = toError(e);
    return res.ok ? { ok: false, error: "Unknown error" } : { ok: false, error: res.error };
  }
}

export async function deleteMasterAction(kind: MasterKind, id: number): Promise<ActionResult> {
  try {
    await masters.deleteMaster(kind, id);
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}
