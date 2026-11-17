import Link from "next/link";
import { notFound } from "next/navigation";
import { DocActions, type NextStep } from "@/components/DocActions";
import { Badge, Card, Field, Money, PageHeader } from "@/components/ui";
import { DOC_META, docHref, fmtMoney, fmtQty, type DocKind } from "@/lib/docs-meta";
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

export default async function DocViewPage({ params, searchParams }: PageProps<"/docs/[kind]/[id]">) {
  const { kind, id } = await params;
  const { err } = await searchParams;
  if (!(kind in DOC_META)) notFound();
  const k = kind as DocKind;
  const doc = await getDoc(k, Number(id));
  if (!doc) notFound();
  const { head, lines, related, allocations } = doc;
  const meta = DOC_META[k];
  const hasMoneyLines = lines.some((l) => l.amount !== undefined);

  const progressCol: Partial<Record<DocKind, [string, string]>> = {
    purchase_order: ["received_qty", "Received"],
    grn: ["billed_qty", "Billed"],
    sales_order: ["invoiced_qty", "Delivered"],
    sales_invoice: ["returned_qty", "Returned"],
  };
  const prog = progressCol[k];

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
            status={head.status}
            closed={Boolean(head.closed)}
            next={nextSteps(k, head, lines)}
            printable={k === "sales_invoice" || k === "purchase_order"}
          />
        }
      />

      {typeof err === "string" && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>
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
                  <th>Item</th>
                  <th className="num">Qty</th>
                  {k === "grn" && <th className="num">Rejected</th>}
                  {prog && <th className="num">{prog[1]}</th>}
                  {(k === "grn" || k === "sales_invoice" || k === "stock_transfer" || k === "stock_adjustment") && <th>Batch</th>}
                  {k === "sales_return" && <th>Condition</th>}
                  {hasMoneyLines && <th className="num">Rate / pc</th>}
                  {hasMoneyLines && <th className="num">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const ppc = n(l.pcs_per_carton) || 1;
                  return (
                    <tr key={String(l.id)}>
                      <td>
                        {String(l.item_name)} <span className="text-xs text-slate-400">{String(l.item_code)}</span>
                      </td>
                      <td className="num whitespace-nowrap">{fmtQty(n(l.qty), ppc)}</td>
                      {k === "grn" && <td className="num">{n(l.rejected_qty) ? fmtQty(n(l.rejected_qty), ppc) : ""}</td>}
                      {prog && (
                        <td className={`num whitespace-nowrap ${n(l[prog[0]]) >= n(l.qty) && k !== "sales_invoice" ? "text-emerald-700" : ""}`}>
                          {n(l[prog[0]]) ? fmtQty(n(l[prog[0]]), ppc) : "—"}
                        </td>
                      )}
                      {(k === "grn" || k === "sales_invoice" || k === "stock_transfer" || k === "stock_adjustment") && (
                        <td className="text-xs text-slate-600">{l.batch ? String(l.batch) : l.has_batch ? "auto" : ""}</td>
                      )}
                      {k === "sales_return" && <td>{String(l.condition)}</td>}
                      {hasMoneyLines && <td className="num">{fmtMoney(n(l.rate))}</td>}
                      {hasMoneyLines && <td className="num">{fmtMoney(n(l.amount))}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {allocations.length > 0 && (
        <Card title="Applied to" className="mb-4">
          <table className="tbl">
            <tbody>
              {allocations.map((a) => (
                <tr key={String(a.doc_id)}>
                  <td>
                    <Link className="text-sky-700 hover:underline" href={docHref(k === "receipt" ? "sales_invoice" : "purchase_bill", Number(a.doc_id))}>
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
        </Card>
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
