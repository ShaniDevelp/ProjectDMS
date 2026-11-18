import Link from "next/link";
import { notFound } from "next/navigation";
import { DocRowDelete } from "@/components/DocActions";
import { QuickViewButton } from "@/components/QuickView";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { DOC_EXTRA_LABEL, DOC_META, docHref, fmtMoney, isDocKind, type DocKind } from "@/lib/docs-meta";
import { listDocs } from "@/server/queries";

type Row = Awaited<ReturnType<typeof listDocs>>[number];

/** Documents that can only be made from a source document. */
const FROM_SOURCE: Partial<Record<DocKind, string>> = {
  purchase_bill: "Open a submitted Goods Receipt and click “Create Purchase Bill”.",
  sales_return: "Open a submitted Sales Invoice and click “Create Return”.",
};

/** Kinds tracked by line progress, with the wording for the pending summary. */
const PROGRESS: Partial<Record<DocKind, { verb: string; col: string }>> = {
  sales_order: { verb: "to deliver", col: "Delivered" },
  purchase_order: { verb: "to receive", col: "Received" },
  grn: { verb: "to bill", col: "Billed" },
};

/** The one most useful next document for a row, created pre-filled from it. */
function nextAction(kind: DocKind, r: Row): { kind: DocKind; label: string } | null {
  if (r.status !== "submitted") return null;
  const pending = r.totalQty !== null && r.doneQty !== null && r.doneQty < r.totalQty;
  switch (kind) {
    case "sales_order":
      return pending && !r.closed ? { kind: "sales_invoice", label: "Create Invoice" } : null;
    case "purchase_order":
      return pending && !r.closed ? { kind: "grn", label: "Receive (GRN)" } : null;
    case "grn":
      return pending ? { kind: "purchase_bill", label: "Create Bill" } : null;
    case "sales_invoice":
      return (r.open ?? 0) > 0 ? { kind: "receipt", label: "Receive Payment" } : null;
    case "purchase_bill":
      return (r.open ?? 0) > 0 ? { kind: "supplier_payment", label: "Pay" } : null;
    default:
      return null;
  }
}

function href(kind: DocKind, status: string | undefined, q: string | undefined) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  const s = p.toString();
  return s ? `${docHref(kind)}?${s}` : docHref(kind);
}

export default async function DocListPage({ params, searchParams }: PageProps<"/docs/[kind]">) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status ? sp.status : undefined;
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim() : undefined;

  const meta = DOC_META[kind];
  const all = await listDocs(kind);
  const showMoney = all.some((r) => r.total !== null);
  const showOpen = all.some((r) => r.open !== null);
  const prog = PROGRESS[kind];
  const extraLabel = DOC_EXTRA_LABEL[kind];
  const partyLabel = meta.party === "customer" ? "Customer" : meta.party === "supplier" ? "Supplier" : "Warehouse";

  // Status tabs, in the order statuses first appear (newest first), with counts.
  const tabs = new Map<string, { tone: Row["badge"]["tone"]; count: number }>();
  for (const r of all) {
    const t = tabs.get(r.badge.label);
    if (t) t.count++;
    else tabs.set(r.badge.label, { tone: r.badge.tone, count: 1 });
  }

  const needle = q?.toLowerCase();
  const rows = all.filter(
    (r) =>
      (!status || r.badge.label === status) &&
      (!needle || [r.no, r.party, r.extra ?? ""].some((v) => v.toLowerCase().includes(needle))),
  );

  // Summary across all live documents (ignores filters so the numbers stay stable).
  const live = all.filter((r) => r.status === "submitted");
  const pendingDocs = prog ? live.filter((r) => !r.closed && (r.pendingAmt ?? 0) > 0) : [];
  const pendingValue = pendingDocs.reduce((s, r) => s + (r.pendingAmt ?? 0), 0);
  const openValue = showOpen ? live.reduce((s, r) => s + Math.max(0, r.open ?? 0), 0) : 0;
  const overdue = showOpen ? live.filter((r) => (r.open ?? 0) > 0 && r.badge.label === "Overdue") : [];
  const drafts = all.filter((r) => r.status === "draft").length;


  return (
    <>
      <PageHeader
        title={meta.plural}
        subtitle={meta.blurb}
        actions={
          FROM_SOURCE[kind] ? null : (
            <Link href={`${docHref(kind)}/new`} className="btn-primary">
              + New {meta.title}
            </Link>
          )
        }
      />
      {FROM_SOURCE[kind] && <p className="mb-3 text-sm text-slate-600">{FROM_SOURCE[kind]}</p>}

      {all.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label={`All ${meta.plural.toLowerCase()}`} value={String(all.length)} />
          {prog && (
            <Summary
              label={`Pending ${prog.verb}`}
              value={fmtMoney(pendingValue)}
              hint={`${pendingDocs.length} document${pendingDocs.length === 1 ? "" : "s"}`}
              tone={pendingDocs.length ? "amber" : undefined}
            />
          )}
          {showOpen && <Summary label="Still to be paid" value={fmtMoney(openValue)} tone={openValue > 0 ? "amber" : undefined} />}
          {showOpen && (
            <Summary
              label="Overdue"
              value={fmtMoney(overdue.reduce((s, r) => s + (r.open ?? 0), 0))}
              hint={`${overdue.length} document${overdue.length === 1 ? "" : "s"}`}
              tone={overdue.length ? "red" : undefined}
            />
          )}
          {drafts > 0 && <Summary label="Drafts (not submitted)" value={String(drafts)} hint="No effect until submitted" />}
        </div>
      )}

      <Card>
        {all.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5">
            <nav className="flex flex-wrap gap-1.5">
              <TabLink href={href(kind, undefined, q)} active={!status} label="All" count={all.length} />
              {[...tabs].map(([label, t]) => (
                <TabLink key={label} href={href(kind, label, q)} active={status === label} label={label} count={t.count} />
              ))}
            </nav>
            <form method="get" className="flex items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder={`Search no., ${partyLabel.toLowerCase()}${extraLabel ? `, ${extraLabel.toLowerCase()}` : ""}…`}
                className="w-64 max-w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button className="btn" type="submit">
                Search
              </button>
            </form>
          </div>
        )}

        {all.length === 0 ? (
          <Empty>No {meta.plural.toLowerCase()} yet.</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            Nothing matches.{" "}
            <Link className="text-sky-700 hover:underline" href={docHref(kind)}>
              Clear filters
            </Link>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>{partyLabel}</th>
                  {extraLabel && <th>{extraLabel}</th>}
                  {prog && <th>{prog.col}</th>}
                  {showMoney && <th className="num">Amount</th>}
                  {showOpen && <th className="num">Open</th>}
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const action = nextAction(kind, r);
                  const pct = r.totalQty ? Math.min(100, Math.round(((r.doneQty ?? 0) / r.totalQty) * 100)) : 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap">
                        <Link href={docHref(kind, r.id)} className="font-medium text-sky-700 hover:underline">
                          {r.no}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">
                        {r.date}
                        {r.dueDate && r.status === "submitted" && (r.open ?? 0) > 0 && (
                          <div className="text-xs text-slate-400">due {r.dueDate}</div>
                        )}
                      </td>
                      <td className="font-medium text-slate-900">{r.party}</td>
                      {extraLabel && <td className="text-slate-500 capitalize">{r.extra ?? ""}</td>}
                      {prog && (
                        <td className="min-w-32">
                          {r.status === "cancelled" ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-sky-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
                            </div>
                          )}
                          {r.status === "submitted" && !r.closed && (r.pendingAmt ?? 0) > 0 && pct > 0 && (
                            <div className="mt-0.5 text-xs text-amber-700">{fmtMoney(r.pendingAmt)} left</div>
                          )}
                        </td>
                      )}
                      {showMoney && (
                        <td className="num whitespace-nowrap font-medium">{r.total === null ? "" : <Money v={r.total} />}</td>
                      )}
                      {showOpen && (
                        <td className={`num whitespace-nowrap ${r.badge.label === "Overdue" ? "text-red-700" : ""}`}>
                          {r.open ? <Money v={r.open} /> : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      <td>
                        <Badge {...r.badge} />
                      </td>
                      <td className="num whitespace-nowrap">
                        <span className="inline-flex items-center justify-end gap-2">
                          <QuickViewButton kind={kind} id={r.id} files={r.files} />
                          {action ? (
                            <Link
                              href={`${docHref(action.kind)}/new?from=${r.id}`}
                              className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                            >
                              {action.label} →
                            </Link>
                          ) : r.status === "draft" ? (
                            <Link href={docHref(kind, r.id)} className="text-xs text-slate-500 hover:text-sky-700 hover:underline">
                              Review &amp; submit
                            </Link>
                          ) : null}
                          <DocRowDelete kind={kind} id={r.id} no={r.no} status={r.status} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const SUMMARY_TONE = {
  amber: "text-amber-700",
  red: "text-red-700",
} as const;

function Summary({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: keyof typeof SUMMARY_TONE }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone ? SUMMARY_TONE[tone] : "text-slate-900"}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function TabLink({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 tabular-nums ${active ? "bg-white/20" : "bg-white text-slate-500"}`}>{count}</span>
    </Link>
  );
}
