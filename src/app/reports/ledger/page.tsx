import Link from "next/link";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { DOC_META, docHref, fmtQty, isDocKind } from "@/lib/docs-meta";
import { formOptions, stockLedgerReport } from "@/server/queries";

const n = (v: unknown) => Number(v ?? 0);

export default async function LedgerPage({ searchParams }: PageProps<"/reports/ledger">) {
  const { item } = await searchParams;
  const itemId = Number(item) || undefined;
  const [rows, opts] = await Promise.all([stockLedgerReport(itemId), formOptions()]);
  return (
    <>
      <PageHeader title="Stock Ledger" subtitle="Every stock movement with its reason. Rows are never edited; cancellations add reverse rows." />
      <form className="mb-3 flex gap-2">
        <select name="item" defaultValue={itemId ?? ""} className="input max-w-xs">
          <option value="">All items</option>
          {opts.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <Empty>No movements yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Item</th>
                  <th>Warehouse</th>
                  <th>Batch</th>
                  <th>Document</th>
                  <th className="num">In / Out</th>
                  <th className="num">Rate</th>
                  <th className="num">Value change</th>
                  <th className="num">Balance after</th>
                  <th className="num">Avg cost after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ppc = n(r.pcs_per_carton);
                  const vt = String(r.voucher_type);
                  return (
                    <tr key={String(r.id)} className={r.reverses_id ? "text-slate-400" : ""}>
                      <td className="whitespace-nowrap text-xs">{new Date(String(r.posted_at)).toLocaleString("en-PK")}</td>
                      <td>{String(r.item)}</td>
                      <td>{String(r.warehouse)}</td>
                      <td className="text-xs">{String(r.batch_no ?? "")}</td>
                      <td className="whitespace-nowrap">
                        {isDocKind(vt) ? (
                          <Link className="text-sky-700 hover:underline" href={docHref(vt, n(r.voucher_id))}>
                            {DOC_META[vt].title} #{n(r.voucher_id)}
                          </Link>
                        ) : (
                          vt
                        )}
                        {r.reverses_id ? <span className="ml-1 text-xs">(reversal)</span> : null}
                      </td>
                      <td className={`num whitespace-nowrap ${n(r.qty) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {n(r.qty) > 0 ? "+" : ""}
                        {fmtQty(n(r.qty), ppc)}
                      </td>
                      <td className="num">
                        <Money v={n(r.rate)} />
                      </td>
                      <td className="num">
                        <Money v={n(r.value_change)} />
                      </td>
                      <td className="num whitespace-nowrap">{fmtQty(n(r.qty_after), ppc)}</td>
                      <td className="num">
                        <Money v={n(r.valuation_rate_after)} />
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
