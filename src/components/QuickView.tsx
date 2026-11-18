"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { DOC_EXTRA_LABEL, DOC_META, docHref, fmtMoney, fmtQty, type DocKind } from "@/lib/docs-meta";
import { FileLinks, fileBadge, isImage, PreviewBody, savedView, type Meta, type View } from "./Attachments";
import { Modal } from "./Modal";
import { Badge } from "./ui";

type Row = Record<string, unknown>;
type Doc = {
  head: Row & { id: number; no: string; status: string; badge: { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" } };
  lines: Row[];
  allocations: Row[];
  related: { kind: DocKind; id: number; no: string; status: string }[];
  files: Meta[];
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const isPayment = (k: DocKind) => k === "receipt" || k === "supplier_payment";

/** "View" button for a list row: opens the whole document, its proof files and their previews in a popup. */
export function QuickViewButton({ kind, id, files }: { kind: DocKind; id: number; files: number }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<View | null>(null);

  const show = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${kind}/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDoc(await res.json());
    } catch {
      setError("Could not load this document.");
    }
  };
  const close = useCallback(() => setOpen(false), []);
  const meta = DOC_META[kind];

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {files > 0 && (
          <button
            type="button"
            onClick={show}
            title={`${files} file${files === 1 ? "" : "s"} attached`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <ClipIcon /> {files}
          </button>
        )}
        <button
          type="button"
          onClick={show}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-sky-300 hover:text-sky-700"
        >
          View
        </button>
      </span>

      <Modal
        open={open}
        onClose={close}
        wide
        title={
          preview ? (
            <span className="break-all">{preview.name}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {meta.title} {doc?.head.no ?? ""}
              {doc && <Badge {...doc.head.badge} />}
            </span>
          )
        }
        subtitle={
          preview ? (
            <span className="flex flex-wrap items-center gap-3">
              <button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setPreview(null)}>
                ← Back to details
              </button>
              <FileLinks file={preview} />
            </span>
          ) : (
            meta.blurb
          )
        }
      >
        {error ? (
          <p className="py-8 text-center text-sm text-red-600">{error}</p>
        ) : !doc ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : preview ? (
          <PreviewBody file={preview} />
        ) : (
          <DocBody kind={kind} doc={doc} onPreview={setPreview} />
        )}
      </Modal>
    </>
  );
}

function DocBody({ kind, doc, onPreview }: { kind: DocKind; doc: Doc; onPreview: (v: View) => void }) {
  const h = doc.head;
  const meta = DOC_META[kind];
  const total = n(h.total);
  const allocated = doc.allocations.reduce((s, a) => s + n(a.amount), 0);
  const advance = Math.max(0, total - allocated);
  const partyLabel = meta.party === "supplier" ? "Supplier" : meta.party === "customer" ? "Customer" : "Warehouse";
  const extraLabel = DOC_EXTRA_LABEL[kind];
  const methodText = String(h.method ?? h.extra ?? "");

  return (
    <div className="space-y-5">
      {/* Headline */}
      {isPayment(kind) ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtMoney(total)}</div>
          <div className="mt-0.5 text-sm text-slate-600">
            {kind === "supplier_payment" ? "Paid to" : "Received from"} <b className="text-slate-800">{String(h.party)}</b>
            {methodText && (
              <>
                {" "}
                by <b className="capitalize text-slate-800">{methodText}</b>
              </>
            )}{" "}
            on <b className="text-slate-800">{String(h.date)}</b>
          </div>
        </div>
      ) : null}

      {/* Fields */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Info label="Number">{h.no}</Info>
        <Info label="Date">{String(h.date)}</Info>
        {h.party ? <Info label={partyLabel}>{String(h.party)}</Info> : null}
        {!isPayment(kind) && h.total !== null && h.total !== undefined && <Info label="Total">{fmtMoney(total)}</Info>}
        {h.open !== undefined && h.open !== null && !isPayment(kind) && <Info label="Still to pay">{fmtMoney(n(h.open))}</Info>}
        {h.due_date ? <Info label="Due date">{String(h.due_date)}</Info> : null}
        {extraLabel && h.extra ? (
          <Info label={extraLabel}>
            <span className="capitalize">{String(h.extra)}</span>
          </Info>
        ) : null}
        {isPayment(kind) && <Info label="Reference (cheque / txn)">{h.reference ? String(h.reference) : <Muted>Not entered</Muted>}</Info>}
        {h.supplier_ref ? <Info label="Challan no.">{String(h.supplier_ref)}</Info> : null}
        <Info label="Status">
          <span className="capitalize">{h.status}</span>
        </Info>
        {h.remarks ? (
          <div className="col-span-2 sm:col-span-3">
            <Info label="Remarks">{String(h.remarks)}</Info>
          </div>
        ) : null}
      </dl>

      {/* Where the money went */}
      {isPayment(kind) && (
        <Block title={kind === "supplier_payment" ? "Bills paid" : "Invoices paid"}>
          {doc.allocations.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">{h.status === "draft" ? "Allocated when submitted (oldest due first)." : "Not applied to any bill."}</p>
          ) : (
            <table className="tbl">
              <tbody>
                {doc.allocations.map((a) => (
                  <tr key={String(a.doc_id)}>
                    <td>
                      <Link
                        className="font-medium text-sky-700 hover:underline"
                        href={docHref(kind === "receipt" ? "sales_invoice" : "purchase_bill", n(a.doc_id))}
                      >
                        {String(a.no)}
                      </Link>
                    </td>
                    <td className="num">{fmtMoney(n(a.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {h.status === "submitted" && advance > 0 && (
            <div className="flex justify-between border-t border-slate-100 bg-amber-50/50 px-3 py-2 text-sm">
              <span className="text-amber-800">Kept as advance</span>
              <span className="font-medium tabular-nums text-amber-800">{fmtMoney(advance)}</span>
            </div>
          )}
        </Block>
      )}

      {/* Items */}
      {doc.lines.length > 0 && (
        <Block title={`Items (${doc.lines.length})`}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                {doc.lines.some((l) => l.amount !== undefined) && <th className="num">Rate</th>}
                {doc.lines.some((l) => l.amount !== undefined) && <th className="num">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={String(l.id)}>
                  <td>
                    {String(l.item_name)} <span className="text-xs text-slate-400">{String(l.item_code ?? "")}</span>
                  </td>
                  <td className="num whitespace-nowrap">{fmtQty(n(l.qty), n(l.pcs_per_carton) || 1)}</td>
                  {l.amount !== undefined && <td className="num">{fmtMoney(n(l.rate))}</td>}
                  {l.amount !== undefined && <td className="num">{fmtMoney(n(l.amount))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {/* Proof */}
      <Block title={`${isPayment(kind) ? "Payment proof" : "Attachments"} (${doc.files.length})`}>
        {doc.files.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">
            Nothing attached.{" "}
            <Link className="text-sky-700 hover:underline" href={docHref(kind, h.id)}>
              Add from the full page
            </Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4">
            {doc.files.map(savedView).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onPreview(f)}
                className="group overflow-hidden rounded-lg border border-slate-200 text-left hover:border-sky-300 hover:shadow-sm"
                title="Click to preview"
              >
                <div className="flex h-28 items-center justify-center bg-slate-50">
                  {isImage(f.mime) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className={`flex h-12 w-12 items-center justify-center rounded-lg text-xs font-bold ${fileBadge(f.name, f.mime).cls}`}>
                      {fileBadge(f.name, f.mime).label}
                    </span>
                  )}
                </div>
                <div className="truncate px-2 py-1.5 text-xs font-medium text-slate-700 group-hover:text-sky-700">{f.name}</div>
              </button>
            ))}
          </div>
        )}
      </Block>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Link className="btn-primary" href={docHref(kind, h.id)}>
          Open full page →
        </Link>
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="font-normal text-slate-400">{children}</span>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function ClipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
