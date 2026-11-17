import { connection } from "next/server";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { salesBySalesperson } from "@/server/queries";
import { today } from "@/server/util";

const n = (v: unknown) => Number(v ?? 0);

export default async function SalesReport({ searchParams }: PageProps<"/reports/sales">) {
  await connection();
  const sp = await searchParams;
  const to = typeof sp.to === "string" ? sp.to : today();
  const from = typeof sp.from === "string" ? sp.from : `${to.slice(0, 8)}01`;
  const rows = await salesBySalesperson(from, to);
  return (
    <>
      <PageHeader title="Sales by Salesperson" subtitle="Sales, margin, returns and cash collected per salesperson." />
      <form className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">From</label>
          <input type="date" name="from" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" name="to" defaultValue={to} className="input" />
        </div>
        <button className="btn">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <Empty>No sales in this period.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Salesperson</th>
                <th className="num">Invoices</th>
                <th className="num">Shops</th>
                <th className="num">Sales</th>
                <th className="num">Margin</th>
                <th className="num">Returns</th>
                <th className="num">Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.salesperson)}>
                  <td>{String(r.salesperson)}</td>
                  <td className="num">{n(r.invoices)}</td>
                  <td className="num">{n(r.shops)}</td>
                  <td className="num">
                    <Money v={n(r.sales)} />
                  </td>
                  <td className="num">
                    <Money v={n(r.margin)} />{" "}
                    <span className="text-xs text-slate-500">{n(r.sales) ? Math.round((n(r.margin) / n(r.sales)) * 100) : 0}%</span>
                  </td>
                  <td className="num">
                    <Money v={n(r.returns)} />
                  </td>
                  <td className="num">
                    <Money v={n(r.collected)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
