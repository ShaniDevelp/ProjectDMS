import Link from "next/link";
import { Card, Empty, Money, PageHeader, Stat } from "@/components/ui";
import { docHref, fmtMoney, fmtQty } from "@/lib/docs-meta";
import { dashboard } from "@/server/queries";

export default async function Dashboard() {
  const d = await dashboard();
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Today at a glance"
        actions={
          <>
            <Link className="btn-primary" href="/docs/sales_order/new">+ Sales Order</Link>
            <Link className="btn" href="/docs/receipt/new">+ Receipt</Link>
            <Link className="btn" href="/docs/purchase_order/new">+ Purchase Order</Link>
          </>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Sales today" value={fmtMoney(d.salesToday)} hint={`${d.invoicesToday} invoice(s)`} href="/docs/sales_invoice" />
        <Stat label="Collected today" value={fmtMoney(d.collectedToday)} href="/docs/receipt" />
        <Stat label="Shops owe us" value={fmtMoney(d.receivable)} href="/reports/aging" />
        <Stat label="We owe suppliers" value={fmtMoney(d.payable)} href="/masters/suppliers" />
        <Stat label="Money in stock" value={fmtMoney(d.stockValue)} href="/reports/stock" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Overdue bills — collect first">
          {d.overdue.length === 0 ? (
            <Empty>No overdue bills.</Empty>
          ) : (
            <table className="tbl">
              <tbody>
                {d.overdue.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link className="text-sky-700 hover:underline" href={docHref("sales_invoice", o.id)}>{o.no}</Link>
                      <div className="text-xs text-slate-500">{o.customer}</div>
                    </td>
                    <td className="num text-red-700">{o.days}d late</td>
                    <td className="num"><Money v={o.open} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Running low — reorder">
          {d.low.length === 0 ? (
            <Empty>Nothing below reorder level.</Empty>
          ) : (
            <table className="tbl">
              <tbody>
                {d.low.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td className="num text-amber-700">{fmtQty(l.qty, l.ppc)}</td>
                    <td className="num text-xs text-slate-500">min {fmtQty(l.reorder, l.ppc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Top salespeople this month">
          {d.topSalespeople.length === 0 ? (
            <Empty>No sales this month yet.</Empty>
          ) : (
            <table className="tbl">
              <tbody>
                {d.topSalespeople.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="num"><Money v={s.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
