import Link from "next/link";
import { notFound } from "next/navigation";
import { DocAttachments } from "@/components/Attachments";
import { DocActions, type NextStep } from "@/components/DocActions";
import { Badge, Card, Field, Money, PageHeader } from "@/components/ui";
import { DOC_META, docHref, fmtMoney, fmtQty, type DocKind } from "@/lib/docs-meta";
import { listAttachments } from "@/server/attachments";
import { getDoc } from "@/server/queries";

const n = (v: unknown) => Number(v ?? 0);

function nextSteps(kind: DocKind, head: Record<string, unknown>, lines: Record<string, unknown>[]): NextStep[] {
  const open = n(head.open);
  switch (kind) {
    case "purchase_order":
      return !head.closed && lines.some((l) => n(l.received_qty) < n(l.qty)) ? [{ kind: "grn", label: "Receive goods (GRN)" }] : [];
    case "grn":
      return lines.some((l) => n(l.billed_qty) < n(l.qty)) ? [{ kind: "purchase_bill", label: "Create Purchase Bill" }] : [];
    case "purchase_bill":
      return open > 0 ? [{ kind: "supplier_payment", label: "Pay supplier" }] : [];
    case "sales_order":
      return !head.closed && lines.some((l) => n(l.invoiced_qty) < n(l.qty)) ? [{ kind: "sales_invoice", label: "Create Invoice (deliver)" }] : [];
    case "sales_invoice": {
      const steps: NextStep[] = [];
      if (open > 0) steps.push({ kind: "receipt", label: "Receive payment" });
      if (lines.some((l) => n(l.returned_qty) < n(l.qty))) steps.push({ kind: "sales_return", label: "Create Return" });
      return steps;
    }
    default:
      return [];
  }
}

export default async function DocViewPage({ params }: PageProps<"/docs/[kind]/[id]">) {
  const { kind, id } = await params;
  if (!(kind in DOC_META)) notFound();
  const k = kind as DocKind;
  const [doc, files] = await Promise.all([getDoc(k, Number(id)), listAttachments(k, Number(id))]);
  if (!doc) notFound();
  const { head, lines, related, allocations } = doc;
  const meta = DOC_META[k];
  const isPay = k === "receipt" || k === "supplier_payment";
  const advance = isPay ? Math.max(0, n(head.total) - allocations.reduce((sum, a) => sum + n(a.amount), 0)) : 0;
  const hasMoneyLines = lines.some((l) => l.amount !== undefined);

  const progressCol: Partial<Record<DocKind, [string, string]>> = {
    purchase_order: ["received_qty", "Received"],
    grn: ["billed_qty", "Billed"],
    sales_order: ["invoiced_qty", "Delivered"],
    sales_invoice: ["returned_qty", "Returned"],
  };
  const prog = progressCol[k];
  const pendingLabel: Partial<Record<DocKind, string>> = { purchase_order: "To receive", grn: "To bill", sales_order: "To deliver" };
  const pendLabel = pendingLabel[k];
  const showPending = Boolean(pendLabel) && head.status !== "cancelled" && !head.closed;
  const hasBatchCol = k === "grn" || k === "sales_invoice" || k === "stock_transfer" || k === "stock_adjustment";
  const totalAmount = lines.reduce((s, l) => s + n(l.amount), 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {meta.title} {head.no} <Badge {...head.badge} />
          </span>
        }
        subtitle={
          <Link className="text-sky-700 hover:underline" href={docHref(k)}>
            ← All {meta.plural.toLowerCase()}
          </Link>
        }
        actions={
          <DocActions
            kind={k}
            id={head.id}
            no={head.no}
            status={head.status}
            closed={Boolean(head.closed)}
            next={nextSteps(k, head, lines)}
            printable={k === "sales_invoice" || k === "purchase_order"}
          />
        }
      />


      {isPay && (
        <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50/60 px-5 py-4">
          <div className="text-2xl font-semibold tabular-nums">
            <Money v={n(head.total)} />
          </div>
          <div className="mt-0.5 text-sm text-slate-600">
            {k === "supplier_payment" ? "Paid to" : "Received from"} <b className="text-slate-800">{String(head.party)}</b> by{" "}
            <b className="capitalize text-slate-800">{String(head.extra ?? "")}</b> on <b className="text-slate-800">{String(head.date)}</b>
            {head.reference ? (
              <>
                {" "}
                · Ref <b className="text-slate-800">{String(head.reference)}</b>
              </>
            ) : null}
          </div>
        </div>
      )}

      <Card className="mb-4">
        <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Date">{String(head.date)}</Field>
          {head.party ? <Field label={meta.party === "supplier" ? "Supplier" : meta.party === "customer" ? "Customer" : "Warehouse"}>{String(head.party)}</Field> : null}
          {head.due_date ? <Field label="Due date">{String(head.due_date)}</Field> : null}
          {head.total !== null && head.total !== undefined && <Field label={k === "receipt" || k === "supplier_payment" ? "Amount" : "Total"}><Money v={n(head.total)} /></Field>}
          {head.open !== undefined && <Field label="Still to pay"><Money v={n(head.open)} /></Field>}
          {k === "sales_invoice" && head.status === "submitted" && (
            <Field label="Margin">
              {fmtMoney(n(head.total) - n(head.cost))}{" "}
              <span className="text-xs text-slate-500">({n(head.total) ? Math.round(((n(head.total) - n(head.cost)) / n(head.total)) * 100) : 0}%)</span>
            </Field>
          )}
          {head.extra && k !== "purchase_order" ? <Field label={k === "sales_return" ? "Against invoice" : k === "purchase_bill" ? "Supplier bill no." : k === "stock_adjustment" ? "Reason" : k === "receipt" || k === "supplier_payment" ? "Method" : "Salesperson"}>{String(head.extra)}</Field> : null}
          {head.reference ? <Field label="Reference">{String(head.reference)}</Field> : null}
          {head.supplier_ref ? <Field label="Challan no.">{String(head.supplier_ref)}</Field> : null}
          {head.reason && k === "sales_return" ? <Field label="Reason">{String(head.reason)}</Field> : null}
          {head.remarks ? <Field label="Remarks">{String(head.remarks)}</Field> : null}
        </div>
      </Card>

      {lines.length > 0 && (
        <Card className="mb-4">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  {k === "grn" && <th className="num">Rejected</th>}
                  {prog && <th className="num">{prog[1]}</th>}
                  {showPending && <th className="num">{pendLabel}</th>}
                  {hasBatchCol && <th>Batch</th>}
                  {k === "sales_return" && <th>Condition</th>}
                  {hasMoneyLines && <th className="num">Rate / pc</th>}
                  {hasMoneyLines && <th className="num">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const ppc = n(l.pcs_per_carton) || 1;
                  const qty = n(l.qty);
                  const done = prog ? n(l[prog[0]]) : 0;
                  const pct = qty ? Math.min(100, Math.round((done / qty) * 100)) : 0;
                  const pending = Math.max(0, qty - done);
                  return (
                    <tr key={String(l.id)} className="hover:bg-slate-50/60">
                      <td className="text-slate-400 tabular-nums">{i + 1}</td>
                      <td>
                        <div className="font-medium text-slate-900">{String(l.item_name)}</div>
                        <div className="text-xs text-slate-500">
                          {String(l.item_code)}
                          {ppc > 1 ? ` · ${ppc} pcs/ctn` : ""}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">
                        <div className="font-medium">{fmtQty(qty, ppc)}</div>
                        {ppc > 1 && qty >= ppc && <div className="text-xs text-slate-500">{qty} pcs</div>}
                      </td>
                      {k === "grn" && <td className="num whitespace-nowrap">{n(l.rejected_qty) ? fmtQty(n(l.rejected_qty), ppc) : <span className="text-slate-300">—</span>}</td>}
                      {prog && (
                        <td className="num whitespace-nowrap">
                          <div className={done >= qty && k !== "sales_invoice" ? "font-medium text-emerald-700" : ""}>
                            {done ? fmtQty(done, ppc) : <span className="text-slate-300">—</span>}
                          </div>
                          {k !== "sales_invoice" && (
                            <div className="ml-auto mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-200" title={`${pct}%`}>
                              <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </td>
                      )}
                      {showPending && (
                        <td className="num whitespace-nowrap">
                          {pending ? <span className="font-medium text-amber-700">{fmtQty(pending, ppc)}</span> : <span className="text-emerald-700">Done</span>}
                        </td>
                      )}
                      {hasBatchCol && <td className="text-xs text-slate-600">{l.batch ? String(l.batch) : l.has_batch ? "auto" : ""}</td>}
                      {k === "sales_return" && <td className="capitalize">{String(l.condition)}</td>}
                      {hasMoneyLines && (
                        <td className="num whitespace-nowrap">
                          <div>{fmtMoney(n(l.rate))}</div>
                          {ppc > 1 && <div className="text-xs text-slate-500">{fmtMoney(n(l.rate) * ppc)}/ctn</div>}
                        </td>
                      )}
                      {hasMoneyLines && <td className="num whitespace-nowrap font-medium">{fmtMoney(n(l.amount))}</td>}
                    </tr>
                  );
                })}
              </tbody>
              {hasMoneyLines && (
                <tfoot>
                  <tr>
                    <td
                      colSpan={
                        3 +
                        (k === "grn" ? 1 : 0) +
                        (prog ? 1 : 0) +
                        (showPending ? 1 : 0) +
                        (hasBatchCol ? 1 : 0) +
                        (k === "sales_return" ? 1 : 0) +
                        1
                      }
                      className="text-right text-slate-600"
                    >
                      Total ({lines.length} {lines.length === 1 ? "item" : "items"})
                    </td>
                    <td className="num whitespace-nowrap">{fmtMoney(totalAmount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {isPay && (
        <>
      <Card
        className="no-print mb-4"
        title={`${isPay ? "Payment proof" : "Attachments"}${files.length ? ` (${files.length})` : ""}`}
      >
        <DocAttachments kind={k} id={head.id} initial={files} />
      </Card>
        </>
      )}
      {isPay && (
        <Card title={k === "receipt" ? "Invoices paid" : "Bills paid"} className="mb-4">
          {allocations.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              {head.status === "draft" ? "Applied when submitted, oldest due first." : "Not applied to any bill."}
            </p>
          ) : (
            <table className="tbl">
              <tbody>
                {allocations.map((a) => (
                  <tr key={String(a.doc_id)}>
                    <td>
                      <Link className="font-medium text-sky-700 hover:underline" href={docHref(k === "receipt" ? "sales_invoice" : "purchase_bill", Number(a.doc_id))}>
                        {String(a.no)}
                      </Link>
                    </td>
                    <td className="num">
                      <Money v={n(a.amount)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {head.status === "submitted" && advance > 0 && (
            <div className="flex justify-between border-t border-slate-100 bg-amber-50/50 px-4 py-2 text-sm text-amber-800">
              <span>Kept as advance (not yet applied to a bill)</span>
              <span className="font-medium tabular-nums">
                <Money v={advance} />
              </span>
            </div>
          )}
        </Card>
      )}

      {!isPay && (
        <>
      <Card
        className="no-print mb-4"
        title={`${isPay ? "Payment proof" : "Attachments"}${files.length ? ` (${files.length})` : ""}`}
      >
        <DocAttachments kind={k} id={head.id} initial={files} />
      </Card>
        </>
      )}

      {related.length > 0 && (
        <Card title="Linked documents">
          <ul className="divide-y divide-slate-100 text-sm">
            {related.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between px-4 py-2">
                <Link className="text-sky-700 hover:underline" href={docHref(r.kind, r.id)}>
                  {DOC_META[r.kind].title} {r.no}
                </Link>
                <span className="text-xs text-slate-500">{r.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
