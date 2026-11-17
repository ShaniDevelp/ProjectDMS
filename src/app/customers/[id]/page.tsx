import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Empty, Field, Money, PageHeader } from "@/components/ui";
import { DOC_META, docHref, fmtMoney, isDocKind } from "@/lib/docs-meta";
import { customerStatement } from "@/server/queries";

const n = (v: unknown) => Number(v ?? 0);

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const st = await customerStatement(Number(id));
  if (!st) notFound();
  const c = st.customer;
  const cr = st.credit;
  const headroom = cr.creditLimit === null ? null : cr.creditLimit - cr.exposure;
  return (
    <>
      <PageHeader
        title={String(c.name)}
        subtitle={
          <Link className="text-sky-700 hover:underline" href="/masters/customers">
            ← Customers
          </Link>
        }
        actions={
          <>
            <Link className="btn-primary" href="/docs/sales_order/new">
              + Order
            </Link>
            <Link className="btn" href="/docs/receipt/new">
              + Receipt
            </Link>
            <Link className="btn" href={`/masters/customers?edit=${c.id}`}>
              Edit
            </Link>
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Owner">{String(c.owner_name ?? "—")}</Field>
          <Field label="Phone">{String(c.phone ?? "—")}</Field>
          <Field label="Area">{String(c.territory ?? "—")}</Field>
          <Field label="Salesperson">{String(c.salesperson ?? "—")}</Field>
          <Field label="Credit days">{String(c.credit_days)}</Field>
          <Field label="Owes now">
            <Money v={cr.balance} />
          </Field>
          <Field label="Open orders">
            <Money v={cr.openOrders} />
          </Field>
          <Field label="Credit limit">{cr.creditLimit === null ? "No limit" : fmtMoney(cr.creditLimit)}</Field>
          <Field label="Room left">
            {headroom === null ? "—" : <span className={headroom < 0 ? "text-red-700" : ""}>{fmtMoney(headroom)}</span>}
          </Field>
          <Field label="Overdue">
            {cr.overdueCount ? (
              <span className="text-red-700">
                {cr.overdueCount} bill(s), {fmtMoney(cr.overdueAmount)}
              </span>
            ) : (
              "None"
            )}
          </Field>
        </div>
      </Card>
      <Card title="Statement (khata)">
        {st.entries.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Document</th>
                <th className="num">Debit (bill)</th>
                <th className="num">Credit (paid / return)</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.entries.map((e) => {
                const vt = String(e.voucher_type);
                const amt = n(e.amount);
                return (
                  <tr key={String(e.id)} className={e.reverses_id ? "text-slate-400" : ""}>
                    <td>{String(e.date)}</td>
                    <td>
                      {isDocKind(vt) ? (
                        <Link className="text-sky-700 hover:underline" href={docHref(vt, n(e.voucher_id))}>
                          {DOC_META[vt].title} {String(e.voucher_no ?? "")}
                        </Link>
                      ) : (
                        vt
                      )}
                      {e.reverses_id ? <span className="ml-1 text-xs">(cancelled)</span> : null}
                    </td>
                    <td className="num">{amt > 0 ? <Money v={amt} /> : ""}</td>
                    <td className="num">{amt < 0 ? <Money v={-amt} /> : ""}</td>
                    <td className="num font-medium">
                      <Money v={n(e.running)} />
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
