"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import { createDocAction } from "@/app/actions";
import { DOC_META, docHref, fmtMoney, fmtQty, type DocKind } from "@/lib/docs-meta";
import type { FormOptions, Prefill } from "@/server/queries";
import { PendingAttachments, uploadFiles } from "./Attachments";
import { MasterForm } from "./MasterForm";
import { Modal } from "./Modal";

type LineMode = "items" | "grn" | "bill" | "return" | "transfer" | "adjust" | null;

type Line = {
  key: number;
  itemId: string;
  ctn: string;
  pcs: string;
  rate: string;
  rejected: string;
  batchNo: string;
  expiry: string;
  sourceId: number | null;
  maxQty: number | null;
  condition: "good" | "damaged";
  dir: "add" | "remove";
};

const CFG: Record<DocKind, { lines: LineMode; rate: "sell" | "buy" | null; fixed: boolean }> = {
  sales_order: { lines: "items", rate: "sell", fixed: false },
  sales_invoice: { lines: "items", rate: "sell", fixed: false },
  sales_return: { lines: "return", rate: null, fixed: true },
  receipt: { lines: null, rate: null, fixed: true },
  purchase_order: { lines: "items", rate: "buy", fixed: false },
  grn: { lines: "grn", rate: "buy", fixed: false },
  purchase_bill: { lines: "bill", rate: null, fixed: true },
  supplier_payment: { lines: null, rate: null, fixed: true },
  stock_transfer: { lines: "transfer", rate: null, fixed: false },
  stock_adjustment: { lines: "adjust", rate: null, fixed: false },
};

/** Sentinel <option> value that opens the "add new" popup instead of selecting. */
const ADD = "__add__";

type QuickKind = "customers" | "suppliers" | "salespersons" | "warehouses" | "items";
const QUICK: Record<QuickKind, { title: string; option: string; subtitle: string }> = {
  customers: { title: "New customer (shop)", option: "+ Add new customer…", subtitle: "Saved to Setup → Customers and selected here." },
  suppliers: { title: "New supplier", option: "+ Add new supplier…", subtitle: "Saved to Setup → Suppliers and selected here." },
  salespersons: { title: "New salesperson", option: "+ Add new salesperson…", subtitle: "Saved to Setup → Salespeople and selected here." },
  warehouses: { title: "New warehouse / van", option: "+ Add new warehouse / van…", subtitle: "Saved to Setup → Warehouses & Vans and selected here." },
  items: { title: "New item", option: "+ Add new item…", subtitle: "Saved to Setup → Items and selected on this line." },
};

type Lists = Omit<FormOptions, "stock">;
type ItemOpt = Lists["items"][number];
type CustomerOpt = Lists["customers"][number];

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Server row (camelCase, from Drizzle) → the option shape the form uses. */
function toOption(kind: QuickKind, r: Record<string, unknown>) {
  const id = Number(r.id);
  const name = String(r.name ?? "");
  switch (kind) {
    case "items":
      return {
        id,
        name,
        code: String(r.code ?? ""),
        pcs_per_carton: num(r.pcsPerCarton) || 1,
        has_batch: Boolean(r.hasBatch),
        buy_rate: num(r.buyRate),
        sell_rate: num(r.sellRate),
      } satisfies ItemOpt;
    case "customers":
      return {
        id,
        name,
        salesperson_id: r.salespersonId ? Number(r.salespersonId) : null,
        credit_limit: r.creditLimit === null || r.creditLimit === undefined ? null : num(r.creditLimit),
        credit_days: num(r.creditDays),
        balance: 0,
      } satisfies CustomerOpt;
    case "warehouses":
      return { id, name, kind: String(r.kind ?? "godown") };
    default:
      return { id, name };
  }
}

const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name));

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let keySeq = 1;
const blankLine = (): Line => ({
  key: keySeq++,
  itemId: "",
  ctn: "",
  pcs: "",
  rate: "",
  rejected: "",
  batchNo: "",
  expiry: "",
  sourceId: null,
  maxQty: null,
  condition: "good",
  dir: "add",
});

export function DocForm({ kind, options, prefill }: { kind: DocKind; options: FormOptions; prefill: Prefill | null }) {
  const router = useRouter();
  const cfg = CFG[kind];
  const meta = DOC_META[kind];

  // Local copy of the pick-lists so records added from the popup show up immediately.
  const [lists, setLists] = useState<Lists>(() => ({
    items: options.items,
    customers: options.customers,
    suppliers: options.suppliers,
    warehouses: options.warehouses,
    salespersons: options.salespersons,
    territories: options.territories,
  }));
  const itemById = useMemo(() => new Map(lists.items.map((i) => [String(i.id), i])), [lists.items]);
  const ppc = (itemId: string) => itemById.get(itemId)?.pcs_per_carton ?? 1;

  const firstGodown = lists.warehouses.find((w) => w.kind === "godown") ?? lists.warehouses[0];
  const ph = (prefill?.header ?? {}) as Record<string, unknown>;
  const [head, setHead] = useState<Record<string, string>>(() => {
    const h: Record<string, string> = {
      date: localToday(),
      warehouseId: String(ph.warehouseId ?? firstGodown?.id ?? ""),
      fromWarehouseId: String(firstGodown?.id ?? ""),
      toWarehouseId: String(lists.warehouses.find((w) => w.kind === "van")?.id ?? ""),
      customerId: ph.customerId ? String(ph.customerId) : "",
      supplierId: ph.supplierId ? String(ph.supplierId) : "",
      salespersonId: ph.salespersonId ? String(ph.salespersonId) : "",
      amount: ph.amount ? String(ph.amount) : "",
      method: "cash",
      reason: kind === "stock_adjustment" ? "count" : "unsold",
    };
    return h;
  });
  const set = (k: string, v: string) => setHead((h) => ({ ...h, [k]: v }));

  const [lines, setLines] = useState<Line[]>(() => {
    if (prefill?.lines.length) {
      return (prefill.lines as Record<string, unknown>[]).map((l) => {
        const itemId = String(l.item_id);
        const p = itemById.get(itemId)?.pcs_per_carton ?? 1;
        const q = Number(l.qty ?? 0);
        return {
          ...blankLine(),
          itemId,
          ctn: p > 1 ? String(Math.floor(q / p) || "") : "",
          pcs: p > 1 ? String(q % p || "") : String(q || ""),
          rate: String(Number(l.rate ?? 0)),
          sourceId: Number(l.po_line_id ?? l.grn_line_id ?? l.so_line_id ?? l.invoice_line_id),
          maxQty: l.max_qty !== undefined ? Number(l.max_qty) : null,
        };
      });
    }
    return cfg.lines ? [blankLine()] : [];
  });
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const qtyOf = (l: Line) => (Number(l.ctn) || 0) * ppc(l.itemId) + (Number(l.pcs) || 0);
  const amountOf = (l: Line) => qtyOf(l) * (Number(l.rate) || 0);
  const total = lines.reduce((s, l) => s + amountOf(l), 0);

  const stockWh = kind === "stock_transfer" ? head.fromWarehouseId : head.warehouseId;
  const available = (itemId: string) =>
    options.stock.find((s) => String(s.item_id) === itemId && String(s.warehouse_id) === stockWh)?.qty ?? 0;

  const setItem = (key: number, it: ItemOpt | undefined, prevRate: string) => {
    const rate = cfg.rate === "sell" ? it?.sell_rate : cfg.rate === "buy" ? it?.buy_rate : 0;
    patch(key, { itemId: it ? String(it.id) : "", rate: rate ? String(rate) : prevRate });
  };

  const pickCustomer = (c: CustomerOpt | undefined, id: string) =>
    setHead((h) => ({ ...h, customerId: id, salespersonId: c?.salesperson_id ? String(c.salesperson_id) : h.salespersonId }));

  // ───── quick-add popup ─────
  const [quick, setQuick] = useState<{ kind: QuickKind; pick: (opt: Record<string, unknown>) => void } | null>(null);
  const closeQuick = useCallback(() => setQuick(null), []);
  const onQuickSaved = (row: Record<string, unknown>) => {
    if (!quick) return;
    const opt = toOption(quick.kind, row);
    setLists((ls) => ({ ...ls, [quick.kind]: byName([...(ls[quick.kind] as { name: string }[]), opt]) }));
    quick.pick(opt);
    setQuick(null);
  };
  /** onChange for a select that has an "+ Add new…" entry. */
  const withAdd = (qk: QuickKind, onValue: (v: string) => void, pick: (opt: Record<string, unknown>) => void) => (v: string) =>
    v === ADD ? setQuick({ kind: qk, pick }) : onValue(v);

  // ───── build the payload expected by the server schemas ─────
  function payload(): unknown {
    const used = lines.filter((l) => l.itemId);
    const base = { date: head.date, remarks: head.remarks || null };
    switch (kind) {
      case "sales_order":
      case "sales_invoice":
        return {
          ...base,
          customerId: head.customerId,
          salespersonId: head.salespersonId || null,
          warehouseId: head.warehouseId,
          soId: ph.soId ?? null,
          lines: used.map((l) => ({ soLineId: l.sourceId, itemId: l.itemId, qty: qtyOf(l), rate: l.rate || 0 })),
        };
      case "purchase_order":
        return { ...base, supplierId: head.supplierId, warehouseId: head.warehouseId, lines: used.map((l) => ({ itemId: l.itemId, qty: qtyOf(l), rate: l.rate || 0 })) };
      case "grn":
        return {
          ...base,
          supplierId: head.supplierId,
          warehouseId: head.warehouseId,
          poId: ph.poId ?? null,
          supplierRef: head.supplierRef || null,
          lines: used.map((l) => ({
            poLineId: l.sourceId,
            itemId: l.itemId,
            qty: qtyOf(l),
            rejectedQty: Number(l.rejected) || 0,
            rate: l.rate || 0,
            batchNo: l.batchNo || null,
            expiryDate: l.expiry || null,
          })),
        };
      case "purchase_bill":
        return {
          ...base,
          supplierId: head.supplierId,
          grnId: ph.grnId,
          supplierBillNo: head.supplierBillNo || null,
          dueDate: head.dueDate || null,
          lines: used.map((l) => ({ grnLineId: l.sourceId, qty: qtyOf(l), rate: l.rate || 0 })),
        };
      case "sales_return":
        return {
          ...base,
          invoiceId: ph.invoiceId,
          warehouseId: head.warehouseId,
          reason: head.reason,
          lines: used.map((l) => ({ invoiceLineId: l.sourceId, qty: qtyOf(l), condition: l.condition })),
        };
      case "receipt":
        return {
          ...base,
          customerId: head.customerId,
          salespersonId: head.salespersonId || null,
          amount: head.amount,
          method: head.method,
          reference: head.reference || null,
          allocations: ph.invoiceId ? [{ invoiceId: ph.invoiceId, amount: Math.min(Number(head.amount), Number(ph.amount)) }] : [],
        };
      case "supplier_payment":
        return {
          ...base,
          supplierId: head.supplierId,
          amount: head.amount,
          method: head.method,
          reference: head.reference || null,
          allocations: ph.billId ? [{ billId: ph.billId, amount: Math.min(Number(head.amount), Number(ph.amount)) }] : [],
        };
      case "stock_transfer":
        return { ...base, fromWarehouseId: head.fromWarehouseId, toWarehouseId: head.toWarehouseId, lines: used.map((l) => ({ itemId: l.itemId, qty: qtyOf(l) })) };
      case "stock_adjustment":
        return {
          ...base,
          warehouseId: head.warehouseId,
          reason: head.reason,
          lines: used.map((l) => ({
            itemId: l.itemId,
            qtyChange: (l.dir === "remove" ? -1 : 1) * qtyOf(l),
            rate: l.dir === "add" ? l.rate || 0 : 0,
            batchNo: l.dir === "add" ? l.batchNo || null : null,
            expiryDate: l.dir === "add" ? l.expiry || null : null,
          })),
        };
    }
  }

  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (submit: boolean) =>
    start(async () => {
      setError(null);
      const res = await createDocAction(kind, payload(), submit);
      if (!res.ok && !res.id) return setError(res.error);
      // The document exists now (submitted, or saved as draft): attach the proof files to it.
      const failed = res.id && files.length ? await uploadFiles(kind, res.id, files) : [];
      const msgs = [...(!res.ok ? [res.error] : []), ...(failed.length ? [`Saved, but some files did not upload: ${failed.join("; ")}`] : [])];
      router.push(msgs.length ? `${docHref(kind, res.id!)}?err=${encodeURIComponent(msgs.join(" "))}` : docHref(kind, res.id!));
    });

  // ───── render helpers ─────
  const fromSource = !!prefill;
  const showRate = cfg.lines === "items" || cfg.lines === "grn" || cfg.lines === "bill";

  const whSelect = (k: string, label: string) => (
    <Fld label={label}>
      <select
        className="input"
        value={head[k]}
        onChange={(e) => withAdd("warehouses", (v) => set(k, v), (o) => set(k, String(o.id)))(e.target.value)}
      >
        <option value="">Select…</option>
        <option value={ADD}>{QUICK.warehouses.option}</option>
        {lists.warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} {w.kind === "van" ? "(van)" : ""}
          </option>
        ))}
      </select>
    </Fld>
  );

  const customer = lists.customers.find((c) => String(c.id) === head.customerId);
  const showCredit = customer && (kind === "sales_order" || kind === "sales_invoice" || kind === "receipt");
  const exposureAfter = customer ? customer.balance + (kind === "sales_order" || kind === "sales_invoice" ? total : 0) : 0;
  const overLimit = customer && customer.credit_limit !== null && exposureAfter > customer.credit_limit;

  const usedLines = lines.filter((l) => l.itemId && qtyOf(l) > 0);
  const totalPcs = usedLines.reduce((s, l) => s + qtyOf(l), 0);
  const listHref = docHref(kind);

  return (
    <div className="space-y-4 pb-24">
      {/* ───── Details ───── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <SectionHead title="Details" hint={fromSource ? `Filled from ${String(ph.sourceNo)}` : "Fields marked * are required"} />
        <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {meta.party === "customer" && (
            <Fld label="Customer (shop) *">
              <select
                className="input"
                value={head.customerId}
                disabled={fromSource}
                onChange={(e) =>
                  withAdd(
                    "customers",
                    (v) => pickCustomer(lists.customers.find((c) => String(c.id) === v), v),
                    (o) => pickCustomer(o as CustomerOpt, String(o.id)),
                  )(e.target.value)
                }
              >
                <option value="">Select…</option>
                <option value={ADD}>{QUICK.customers.option}</option>
                {lists.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Fld>
          )}
          {meta.party === "supplier" && (
            <Fld label="Supplier *">
              <select
                className="input"
                value={head.supplierId}
                disabled={fromSource}
                onChange={(e) => withAdd("suppliers", (v) => set("supplierId", v), (o) => set("supplierId", String(o.id)))(e.target.value)}
              >
                <option value="">Select…</option>
                <option value={ADD}>{QUICK.suppliers.option}</option>
                {lists.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Fld>
          )}
          {(kind === "sales_order" || kind === "sales_invoice" || kind === "receipt") && (
            <Fld label={kind === "receipt" ? "Collected by" : "Salesperson"}>
              <select
                className="input"
                value={head.salespersonId}
                onChange={(e) => withAdd("salespersons", (v) => set("salespersonId", v), (o) => set("salespersonId", String(o.id)))(e.target.value)}
              >
                <option value="">—</option>
                <option value={ADD}>{QUICK.salespersons.option}</option>
                {lists.salespersons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Fld>
          )}
          {kind === "stock_transfer" ? (
            <>
              {whSelect("fromWarehouseId", "From *")}
              {whSelect("toWarehouseId", "To *")}
            </>
          ) : (
            cfg.lines &&
            kind !== "purchase_bill" &&
            whSelect("warehouseId", kind === "sales_return" ? "Return into *" : kind === "grn" || kind === "purchase_order" ? "Receive into *" : "Warehouse *")
          )}
          <Fld label="Date">
            <input type="date" className="input" value={head.date} onChange={(e) => set("date", e.target.value)} />
          </Fld>
          {(kind === "receipt" || kind === "supplier_payment") && (
            <>
              <Fld label="Amount (Rs) *">
                <input className="input text-base font-semibold" inputMode="decimal" placeholder="0" value={head.amount} onChange={(e) => set("amount", e.target.value)} />
              </Fld>
              <Fld label="Method">
                <select className="input" value={head.method} onChange={(e) => set("method", e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </Fld>
              <Fld label="Reference (cheque / txn no.)">
                <input className="input" value={head.reference ?? ""} onChange={(e) => set("reference", e.target.value)} />
              </Fld>
            </>
          )}
          {kind === "grn" && (
            <Fld label="Supplier delivery challan no.">
              <input className="input" value={head.supplierRef ?? ""} onChange={(e) => set("supplierRef", e.target.value)} />
            </Fld>
          )}
          {kind === "purchase_bill" && (
            <>
              <Fld label="Supplier bill no.">
                <input className="input" value={head.supplierBillNo ?? ""} onChange={(e) => set("supplierBillNo", e.target.value)} />
              </Fld>
              <Fld label="Due date">
                <input type="date" className="input" value={head.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} />
              </Fld>
            </>
          )}
          {kind === "sales_return" && (
            <Fld label="Reason">
              <select className="input" value={head.reason} onChange={(e) => set("reason", e.target.value)}>
                <option value="unsold">Unsold</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
                <option value="wrong_item">Wrong item</option>
                <option value="other">Other</option>
              </select>
            </Fld>
          )}
          {kind === "stock_adjustment" && (
            <Fld label="Reason">
              <select className="input" value={head.reason} onChange={(e) => set("reason", e.target.value)}>
                <option value="count">Physical count</option>
                <option value="opening">Opening stock</option>
                <option value="damage">Damage</option>
                <option value="expiry">Expiry write-off</option>
                <option value="other">Other</option>
              </select>
            </Fld>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <Fld label="Remarks">
              <input className="input" placeholder="Optional note" value={head.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} />
            </Fld>
          </div>
        </div>

        {showCredit && customer && (
          <div className={`flex flex-wrap gap-x-6 gap-y-1 border-t px-4 py-2.5 text-xs ${overLimit ? "border-red-100 bg-red-50/60" : "border-slate-100 bg-slate-50/60"}`}>
            <span className="text-slate-500">
              Owes now: <b className="text-slate-800">{fmtMoney(customer.balance)}</b>
            </span>
            <span className="text-slate-500">
              Credit limit: <b className="text-slate-800">{customer.credit_limit === null ? "No limit" : fmtMoney(customer.credit_limit)}</b>
            </span>
            {customer.credit_limit !== null && (
              <span className="text-slate-500">
                Available: <b className={overLimit ? "text-red-700" : "text-emerald-700"}>{fmtMoney(customer.credit_limit - customer.balance)}</b>
              </span>
            )}
            <span className="text-slate-500">
              Credit days: <b className="text-slate-800">{customer.credit_days}</b>
            </span>
            {overLimit && kind !== "receipt" && <span className="font-medium text-red-700">This {meta.title.toLowerCase()} will go over the credit limit.</span>}
          </div>
        )}
        {(kind === "receipt" || kind === "supplier_payment") && (
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            {ph.invoiceId || ph.billId
              ? `Applied to ${String(ph.sourceNo)} (open ${fmtMoney(Number(ph.amount))}). Any extra stays as advance.`
              : "Applied automatically to the oldest due bills first. Any extra stays as advance."}
          </p>
        )}
      </section>

      {/* ───── Lines ───── */}
      {cfg.lines && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <SectionHead
            title={`Items${usedLines.length ? ` (${usedLines.length})` : ""}`}
            hint="Enter cartons + loose pieces. Qty and amount are worked out for you."
            action={
              !cfg.fixed && (
                <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  + Add item
                </button>
              )
            }
          />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th className="min-w-64">Item</th>
                  {kind === "stock_adjustment" && <th className="w-32">Add / Remove</th>}
                  <th className="w-20">Ctn</th>
                  <th className="w-20">Pcs</th>
                  {kind === "grn" && <th className="w-24">Rejected pcs</th>}
                  {(showRate || kind === "stock_adjustment") && <th className="w-28">Rate / pc</th>}
                  {(kind === "grn" || kind === "stock_adjustment") && <th>Batch / Expiry</th>}
                  {kind === "sales_return" && <th>Condition</th>}
                  <th className="num">Qty</th>
                  {showRate && <th className="num">Amount</th>}
                  {!cfg.fixed && <th className="w-8"></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const it = itemById.get(l.itemId);
                  const q = qtyOf(l);
                  const avail = l.itemId ? available(l.itemId) : null;
                  const short =
                    avail !== null &&
                    (kind === "sales_invoice" || kind === "stock_transfer" || (kind === "stock_adjustment" && l.dir === "remove")) &&
                    q > avail;
                  const lockedItem = cfg.fixed || l.sourceId !== null;
                  const showStock = avail !== null && kind !== "purchase_order" && kind !== "grn";
                  return (
                    <tr key={l.key} className="group">
                      <td className="pt-3.5 text-xs tabular-nums text-slate-400">{idx + 1}</td>
                      <td>
                        <select
                          className="input"
                          value={l.itemId}
                          disabled={lockedItem}
                          onChange={(e) =>
                            withAdd(
                              "items",
                              (v) => setItem(l.key, itemById.get(v), l.rate),
                              (o) => setItem(l.key, o as ItemOpt, l.rate),
                            )(e.target.value)
                          }
                        >
                          <option value="">Select item…</option>
                          {!lockedItem && <option value={ADD}>{QUICK.items.option}</option>}
                          {lists.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.code})
                            </option>
                          ))}
                        </select>
                        {it && (
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            {it.pcs_per_carton > 1 && <Chip>{it.pcs_per_carton} pcs/ctn</Chip>}
                            {showStock && <Chip tone={avail! <= 0 ? "red" : short ? "amber" : "green"}>In stock: {fmtQty(avail!, it.pcs_per_carton)}</Chip>}
                            {l.maxQty !== null && <Chip>Can return: {fmtQty(l.maxQty, it.pcs_per_carton)}</Chip>}
                            {it.has_batch && <Chip>Batch tracked</Chip>}
                          </div>
                        )}
                      </td>
                      {kind === "stock_adjustment" && (
                        <td>
                          <select className="input" value={l.dir} onChange={(e) => patch(l.key, { dir: e.target.value as Line["dir"] })}>
                            <option value="add">+ Add</option>
                            <option value="remove">− Remove</option>
                          </select>
                        </td>
                      )}
                      <td>
                        <input
                          className="input text-right tabular-nums"
                          inputMode="numeric"
                          placeholder={it && it.pcs_per_carton > 1 ? "0" : "–"}
                          disabled={!it || it.pcs_per_carton <= 1}
                          value={l.ctn}
                          onChange={(e) => patch(l.key, { ctn: e.target.value.replace(/\D/g, "") })}
                        />
                      </td>
                      <td>
                        <input
                          className="input text-right tabular-nums"
                          inputMode="numeric"
                          placeholder="0"
                          value={l.pcs}
                          onChange={(e) => patch(l.key, { pcs: e.target.value.replace(/\D/g, "") })}
                        />
                      </td>
                      {kind === "grn" && (
                        <td>
                          <input
                            className="input text-right tabular-nums"
                            inputMode="numeric"
                            placeholder="0"
                            value={l.rejected}
                            onChange={(e) => patch(l.key, { rejected: e.target.value.replace(/\D/g, "") })}
                          />
                        </td>
                      )}
                      {(showRate || kind === "stock_adjustment") && (
                        <td>
                          <input
                            className="input text-right tabular-nums"
                            inputMode="decimal"
                            disabled={kind === "stock_adjustment" && l.dir === "remove"}
                            placeholder={kind === "stock_adjustment" ? "auto" : "0"}
                            value={l.rate}
                            onChange={(e) => patch(l.key, { rate: e.target.value })}
                          />
                          {it && it.pcs_per_carton > 1 && Number(l.rate) > 0 && (
                            <div className="mt-1 text-right text-xs text-slate-500">{fmtMoney(Number(l.rate) * it.pcs_per_carton)}/ctn</div>
                          )}
                        </td>
                      )}
                      {(kind === "grn" || kind === "stock_adjustment") && (
                        <td>
                          {it?.has_batch && (kind === "grn" || l.dir === "add") ? (
                            <div className="flex gap-1">
                              <input className="input w-28" placeholder="Batch no." value={l.batchNo} onChange={(e) => patch(l.key, { batchNo: e.target.value })} />
                              <input type="date" className="input w-36" value={l.expiry} onChange={(e) => patch(l.key, { expiry: e.target.value })} />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{it?.has_batch ? "auto (first expiry)" : "—"}</span>
                          )}
                        </td>
                      )}
                      {kind === "sales_return" && (
                        <td>
                          <select className="input" value={l.condition} onChange={(e) => patch(l.key, { condition: e.target.value as Line["condition"] })}>
                            <option value="good">Good (back to stock)</option>
                            <option value="damaged">Damaged (credit only)</option>
                          </select>
                        </td>
                      )}
                      <td className={`num whitespace-nowrap pt-3.5 ${short ? "font-semibold text-red-600" : "text-slate-700"}`}>
                        {q ? (it ? fmtQty(q, it.pcs_per_carton) : q) : <span className="text-slate-300">—</span>}
                        {short && <div className="text-xs font-normal">not enough stock</div>}
                      </td>
                      {showRate && (
                        <td className="num whitespace-nowrap pt-3.5 font-medium">{amountOf(l) ? fmtMoney(amountOf(l)) : <span className="text-slate-300">—</span>}</td>
                      )}
                      {!cfg.fixed && (
                        <td className="pt-3">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 group-hover:text-slate-500"
                            title="Remove line"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!cfg.fixed && (
            <button
              type="button"
              className="w-full border-t border-dashed border-slate-200 px-4 py-2.5 text-left text-sm font-medium text-sky-700 hover:bg-sky-50/50"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
            >
              + Add another item
            </button>
          )}
        </section>
      )}

      {/* ───── Proof / attachments ───── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <SectionHead
          title={`${kind === "receipt" || kind === "supplier_payment" ? "Payment proof" : "Attachments"}${files.length ? ` (${files.length})` : ""}`}
          hint={
            kind === "receipt" || kind === "supplier_payment"
              ? "Optional: cheque photo, bank slip, transfer screenshot. Click a file to preview."
              : "Optional: challan photo, supplier invoice, signed copy. Click a file to preview."
          }
        />
        <div className="p-4">
          <PendingAttachments files={files} onChange={setFiles} />
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* ───── Sticky action bar ───── */}
      <div className="no-print sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate-500">
            {cfg.lines && (
              <span>
                {usedLines.length} item{usedLines.length === 1 ? "" : "s"} · {totalPcs} pcs
              </span>
            )}
            {showRate && (
              <span>
                Total <span className="ml-1 text-lg font-semibold text-slate-900 tabular-nums">{fmtMoney(total)}</span>
              </span>
            )}
            {(kind === "receipt" || kind === "supplier_payment") && Number(head.amount) > 0 && (
              <span>
                Amount <span className="ml-1 text-lg font-semibold text-slate-900 tabular-nums">{fmtMoney(Number(head.amount))}</span>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Link href={listHref} className="btn">
              Cancel
            </Link>
            <button type="button" className="btn" disabled={pending} onClick={() => save(false)}>
              Save as draft
            </button>
            <button type="button" className="btn-primary px-4" disabled={pending} onClick={() => save(true)}>
              {pending ? "Saving…" : "Save & Confirm"}
            </button>
          </div>
        </div>
      </div>

      <Modal open={!!quick} title={quick ? QUICK[quick.kind].title : ""} subtitle={quick ? QUICK[quick.kind].subtitle : undefined} onClose={closeQuick}>
        {quick && (
          <MasterForm
            key={quick.kind}
            kind={quick.kind}
            initial={null}
            editId={null}
            territories={lists.territories}
            salespersons={lists.salespersons}
            onSaved={onQuickSaved}
            onCancel={closeQuick}
          />
        )}
      </Modal>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const CHIP = {
  gray: "bg-slate-100 text-slate-600",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
} as const;

function Chip({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof CHIP }) {
  return <span className={`rounded px-1.5 py-0.5 ${CHIP[tone]}`}>{children}</span>;
}
