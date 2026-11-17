import Link from "next/link";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtQty } from "@/lib/docs-meta";
import { stockReport } from "@/server/queries";

const n = (v: unknown) => Number(v ?? 0);

export default async function StockPage() {
  const { rows, batches } = await stockReport();
  const totalValue = rows.reduce((s, r) => s + n(r.value), 0);
  return (
    <>
      <PageHeader
        title="Stock Balance"
        subtitle={<>Total value <Money v={totalValue} /> (moving average cost)</>}
        actions={<Link className="btn" href="/docs/stock_adjustment/new">+ Adjust stock</Link>}
      />
      <Card className="mb-4">
        {rows.length === 0 ? (
          <Empty>No stock yet. Receive goods (GRN) or enter opening stock (Adjustment → Opening).</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th><th>Warehouse</th><th className="num">In stock</th><th className="num">Ordered by shops</th>
                  <th className="num">Free to sell</th><th className="num">Cost / pc</th><th className="num">Value</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ppc = n(r.pcs_per_carton);
                  const free = n(r.qty) - n(r.ordered_by_shops);
                  return (
                    <tr key={i}>
                      <td>
                        <Link className="text-sky-700 hover:underline" href={`/reports/ledger?item=${r.id}`}>{String(r.name)}</Link>{" "}
                        <span className="text-xs text-slate-400">{String(r.code)}</span>
                      </td>
                      <td>{String(r.warehouse)}</td>
                      <td className="num whitespace-nowrap">{fmtQty(n(r.qty), ppc)}</td>
                      <td className="num whitespace-nowrap">{n(r.ordered_by_shops) ? fmtQty(n(r.ordered_by_shops), ppc) : ""}</td>
                      <td className={`num whitespace-nowrap ${free < 0 ? "text-red-700" : ""}`}>{fmtQty(free, ppc)}</td>
                      <td className="num"><Money v={n(r.valuation_rate)} /></td>
                      <td className="num"><Money v={n(r.value)} /></td>
                      <td>{n(r.reorder_level) > 0 && n(r.qty) <= n(r.reorder_level) ? <Badge label="Low" tone="amber" /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Batches by expiry">
        {batches.length === 0 ? (
          <Empty>No batch-tracked stock.</Empty>
        ) : (
          <table className="tbl">
            <thead><tr><th>Item</th><th>Warehouse</th><th>Batch</th><th>Expiry</th><th className="num">Qty</th><th></th></tr></thead>
            <tbody>
              {batches.map((b, i) => {
                const days = b.days_left === null ? null : n(b.days_left);
                return (
                  <tr key={i}>
                    <td>{String(b.item)}</td><td>{String(b.warehouse)}</td><td>{String(b.batch_no)}</td>
                    <td>{String(b.expiry_date ?? "—")}</td>
                    <td className="num">{fmtQty(n(b.qty), n(b.pcs_per_carton))}</td>
                    <td>
                      {days !== null && days < 0 && <Badge label="Expired" tone="red" />}
                      {days !== null && days >= 0 && days <= 60 && <Badge label={`${days}d left`} tone="amber" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
