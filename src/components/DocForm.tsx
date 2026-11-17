"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createDocAction } from "@/app/actions";
import { DOC_META, docHref, fmtMoney, fmtQty, type DocKind } from "@/lib/docs-meta";
import type { FormOptions, Prefill } from "@/server/queries";

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
  const itemById = useMemo(() => new Map(options.items.map((i) => [String(i.id), i])), [options.items]);
  const ppc = (itemId: string) => itemById.get(itemId)?.pcs_per_carton ?? 1;

  const firstGodown = options.warehouses.find((w) => w.kind === "godown") ?? options.warehouses[0];
  const ph = (prefill?.header ?? {}) as Record<string, unknown>;
  const [head, setHead] = useState<Record<string, string>>(() => {
    const h: Record<string, string> = {
      date: localToday(),
      warehouseId: String(ph.warehouseId ?? firstGodown?.id ?? ""),
      fromWarehouseId: String(firstGodown?.id ?? ""),
      toWarehouseId: String(options.warehouses.find((w) => w.kind === "van")?.id ?? ""),
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

  const onItem = (l: Line, itemId: string) => {
    const it = itemById.get(itemId);
    const rate = cfg.rate === "sell" ? it?.sell_rate : cfg.rate === "buy" ? it?.buy_rate : 0;
    patch(l.key, { itemId, rate: rate ? String(rate) : l.rate });
  };

  const onCustomer = (id: string) => {
    const c = options.customers.find((x) => String(x.id) === id);
    setHead((h) => ({ ...h, customerId: id, salespersonId: c?.salesperson_id ? String(c.salesperson_id) : h.salespersonId }));
  };

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

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (submit: boolean) =>
    start(async () => {
      setError(null);
      const res = await createDocAction(kind, payload(), submit);
      if (res.ok && res.id) router.push(docHref(kind, res.id));
      else if (!res.ok && res.id) router.push(`${docHref(kind, res.id)}?err=${encodeURIComponent(res.error)}`);
      else if (!res.ok) setError(res.error);
    });

  // ───── render ─────
  const whSelect = (k: string, label: string) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={head[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">Select…</option>
        {options.warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} {w.kind === "van" ? "(van)" : ""}
          </option>
        ))}
      </select>
    </div>
  );

  const fromSource = !!prefill;
  const showRate = cfg.lines === "items" || cfg.lines === "grn" || cfg.lines === "bill";

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        {meta.party === "customer" && (
          <div>
            <label className="label">Customer (shop) *</label>
            <select className="input" value={head.customerId} disabled={fromSource} onChange={(e) => onCustomer(e.target.value)}>
              <option value="">Select…</option>
              {options.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {meta.party === "supplier" && (
          <div>
            <label className="label">Supplier *</label>
            <select className="input" value={head.supplierId} disabled={fromSource} onChange={(e) => set("supplierId", e.target.value)}>
              <option value="">Select…</option>
              {options.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {(kind === "sales_order" || kind === "sales_invoice" || kind === "receipt") && (
          <div>
            <label className="label">{kind === "receipt" ? "Collected by" : "Salesperson"}</label>
            <select className="input" value={head.salespersonId} onChange={(e) => set("salespersonId", e.target.value)}>
              <option value="">—</option>
              {options.salespersons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
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
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={head.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        {(kind === "receipt" || kind === "supplier_payment") && (
          <>
            <div>
              <label className="label">Amount (Rs) *</label>
              <input className="input" inputMode="decimal" value={head.amount} onChange={(e) => set("amount", e.target.value)} />
            </div>
            <div>
              <label className="label">Method</label>
              <select className="input" value={head.method} onChange={(e) => set("method", e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="label">Reference (cheque / txn no.)</label>
              <input className="input" value={head.reference ?? ""} onChange={(e) => set("reference", e.target.value)} />
            </div>
          </>
        )}
        {kind === "grn" && (
          <div>
            <label className="label">Supplier delivery challan no.</label>
            <input className="input" value={head.supplierRef ?? ""} onChange={(e) => set("supplierRef", e.target.value)} />
          </div>
        )}
        {kind === "purchase_bill" && (
          <>
            <div>
              <label className="label">Supplier bill no.</label>
              <input className="input" value={head.supplierBillNo ?? ""} onChange={(e) => set("supplierBillNo", e.target.value)} />
            </div>
            <div>
              <label className="label">Due date</label>
              <input type="date" className="input" value={head.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} />
            </div>
          </>
        )}
        {kind === "sales_return" && (
          <div>
            <label className="label">Reason</label>
            <select className="input" value={head.reason} onChange={(e) => set("reason", e.target.value)}>
              <option value="unsold">Unsold</option>
              <option value="damaged">Damaged</option>
              <option value="expired">Expired</option>
              <option value="wrong_item">Wrong item</option>
              <option value="other">Other</option>
            </select>
          </div>
        )}
        {kind === "stock_adjustment" && (
          <div>
            <label className="label">Reason</label>
            <select className="input" value={head.reason} onChange={(e) => set("reason", e.target.value)}>
              <option value="count">Physical count</option>
              <option value="opening">Opening stock</option>
              <option value="damage">Damage</option>
              <option value="expiry">Expiry write-off</option>
              <option value="other">Other</option>
            </select>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="label">Remarks</label>
          <input className="input" value={head.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} />
        </div>
        {(kind === "receipt" || kind === "supplier_payment") && (
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
            {ph.invoiceId || ph.billId
              ? `Applied to ${String(ph.sourceNo)} (open ${fmtMoney(Number(ph.amount))}). Any extra stays as advance.`
              : "Applied automatically to the oldest due bills first. Any extra stays as advance."}
          </p>
        )}
      </section>

      {cfg.lines && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="tbl">
            <thead>
              <tr>
                <th className="min-w-56">Item</th>
                {kind === "stock_adjustment" && <th>Add / Remove</th>}
                <th className="w-20">Ctn</th>
                <th className="w-20">Pcs</th>
                {kind === "grn" && <th className="w-20">Rejected pcs</th>}
                {(showRate || kind === "stock_adjustment") && <th className="w-28">Rate / pc</th>}
                {(kind === "grn" || kind === "stock_adjustment") && <th>Batch / Expiry</th>}
                {kind === "sales_return" && <th>Condition</th>}
                <th className="num">Qty</th>
                {showRate && <th className="num">Amount</th>}
                {!cfg.fixed && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const it = itemById.get(l.itemId);
                const q = qtyOf(l);
                const avail = l.itemId ? available(l.itemId) : null;
                const short =
                  avail !== null &&
                  (kind === "sales_invoice" || kind === "stock_transfer" || (kind === "stock_adjustment" && l.dir === "remove")) &&
                  q > avail;
                return (
                  <tr key={l.key}>
                    <td>
                      <select className="input" value={l.itemId} disabled={cfg.fixed || l.sourceId !== null} onChange={(e) => onItem(l, e.target.value)}>
                        <option value="">Select item…</option>
                        {options.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.code})
                          </option>
                        ))}
                      </select>
                      {it && (
                        <div className="mt-1 text-xs text-slate-500">
                          {it.pcs_per_carton > 1 ? `${it.pcs_per_carton} pcs/ctn · ` : ""}
                          {avail !== null && kind !== "purchase_order" && kind !== "grn" && <>In stock: {fmtQty(avail, it.pcs_per_carton)}</>}
                          {l.maxQty !== null && <> · Can return: {fmtQty(l.maxQty, it.pcs_per_carton)}</>}
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
                        className="input"
                        inputMode="numeric"
                        disabled={!it || it.pcs_per_carton <= 1}
                        value={l.ctn}
                        onChange={(e) => patch(l.key, { ctn: e.target.value.replace(/\D/g, "") })}
                      />
                    </td>
                    <td>
                      <input className="input" inputMode="numeric" value={l.pcs} onChange={(e) => patch(l.key, { pcs: e.target.value.replace(/\D/g, "") })} />
                    </td>
                    {kind === "grn" && (
                      <td>
                        <input className="input" inputMode="numeric" value={l.rejected} onChange={(e) => patch(l.key, { rejected: e.target.value.replace(/\D/g, "") })} />
                      </td>
                    )}
                    {(showRate || kind === "stock_adjustment") && (
                      <td>
                        <input
                          className="input"
                          inputMode="decimal"
                          disabled={kind === "stock_adjustment" && l.dir === "remove"}
                          placeholder={kind === "stock_adjustment" ? "auto" : ""}
                          value={l.rate}
                          onChange={(e) => patch(l.key, { rate: e.target.value })}
                        />
                        {it && it.pcs_per_carton > 1 && Number(l.rate) > 0 && (
                          <div className="mt-1 text-xs text-slate-500">{fmtMoney(Number(l.rate) * it.pcs_per_carton)}/ctn</div>
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
                    <td className={`num whitespace-nowrap ${short ? "font-semibold text-red-600" : ""}`}>
                      {q ? (it ? fmtQty(q, it.pcs_per_carton) : q) : ""}
                      {short && <div className="text-xs font-normal">short</div>}
                    </td>
                    {showRate && <td className="num whitespace-nowrap">{amountOf(l) ? fmtMoney(amountOf(l)) : ""}</td>}
                    {!cfg.fixed && (
                      <td>
                        <button type="button" className="text-slate-400 hover:text-red-600" title="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            {!cfg.fixed ? (
              <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                + Add item
              </button>
            ) : (
              <span />
            )}
            {showRate && <div className="text-sm font-semibold">Total: {fmtMoney(total)}</div>}
          </div>
        </section>
      )}

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={() => save(true)}>
          {pending ? "Saving…" : `Save & Confirm`}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => save(false)}>
          Save as draft
        </button>
      </div>
    </div>
  );
}
