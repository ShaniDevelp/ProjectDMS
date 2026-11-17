import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { DOC_META, docHref, isDocKind } from "@/lib/docs-meta";
import { listDocs } from "@/server/queries";

/** Documents that can only be made from a source document. */
const FROM_SOURCE: Record<string, string> = {
  purchase_bill: "Open a submitted Goods Receipt and click “Create Purchase Bill”.",
  sales_return: "Open a submitted Sales Invoice and click “Create Return”.",
};

export default async function DocListPage({ params }: PageProps<"/docs/[kind]">) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const meta = DOC_META[kind];
  const rows = await listDocs(kind);
  const showMoney = rows.some((r) => r.total !== null);
  const showOpen = rows.some((r) => r.open !== null);

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
      <Card>
        {rows.length === 0 ? (
          <Empty>No {meta.plural.toLowerCase()} yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>{meta.party === "customer" ? "Customer" : meta.party === "supplier" ? "Supplier" : "Warehouse"}</th>
                  <th></th>
                  {showMoney && <th className="num">Amount</th>}
                  {showOpen && <th className="num">Open</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td>
                      <Link href={docHref(kind, r.id)} className="font-medium text-sky-700 hover:underline">
                        {r.no}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{r.date}</td>
                    <td>{r.party}</td>
                    <td className="text-slate-500">{r.extra}</td>
                    {showMoney && <td className="num">{r.total === null ? "" : <Money v={r.total} />}</td>}
                    {showOpen && <td className="num">{r.open ? <Money v={r.open} /> : ""}</td>}
                    <td>
                      <Badge {...r.badge} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
