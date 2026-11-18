import Link from "next/link";
import { notFound } from "next/navigation";
import { MasterForm } from "@/components/MasterForm";
import { MasterRowDelete } from "@/components/MasterRowDelete";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtQty, isMasterKind, MASTER_TITLES, type MasterKind } from "@/lib/docs-meta";
import { formOptions, mastersList } from "@/server/queries";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** DB row (snake_case) → form values (camelCase). */
function toForm(r: Row): Row {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v ?? ""]));
}

const COLUMNS: Record<MasterKind, { h: string; cell: (r: Row) => React.ReactNode; num?: boolean }[]> = {
  customers: [
    { h: "Shop", cell: (r) => <Link className="text-sky-700 hover:underline" href={`/customers/${r.id}`}>{String(r.name)}</Link> },
    { h: "Area", cell: (r) => String(r.territory ?? "") },
    { h: "Salesperson", cell: (r) => String(r.salesperson ?? "") },
    { h: "Credit limit", num: true, cell: (r) => (r.credit_limit === null ? "No limit" : <Money v={n(r.credit_limit)} />) },
    { h: "Days", num: true, cell: (r) => String(r.credit_days) },
    { h: "Balance", num: true, cell: (r) => <Money v={n(r.balance)} /> },
    { h: "", cell: (r) => (r.blocked ? <Badge label="Blocked" tone="red" /> : null) },
  ],
  items: [
    { h: "Code", cell: (r) => String(r.code) },
    { h: "Name", cell: (r) => String(r.name) },
    { h: "Pcs/ctn", num: true, cell: (r) => String(r.pcs_per_carton) },
    { h: "Buy / pc", num: true, cell: (r) => <Money v={n(r.buy_rate)} /> },
    { h: "Sell / pc", num: true, cell: (r) => <Money v={n(r.sell_rate)} /> },
    { h: "Stock", num: true, cell: (r) => fmtQty(n(r.stock), n(r.pcs_per_carton)) },
    { h: "", cell: (r) => <>{r.has_batch ? <Badge label="Batch" tone="blue" /> : null} {!r.active ? <Badge label="Inactive" tone="gray" /> : null}</> },
  ],
  suppliers: [
    { h: "Name", cell: (r) => String(r.name) },
    { h: "Phone", cell: (r) => String(r.phone ?? "") },
    { h: "We owe", num: true, cell: (r) => <Money v={n(r.balance)} /> },
  ],
  warehouses: [
    { h: "Name", cell: (r) => String(r.name) },
    { h: "Type", cell: (r) => (r.kind === "van" ? "Delivery van" : "Godown") },
    { h: "Stock value", num: true, cell: (r) => <Money v={n(r.stock_value)} /> },
  ],
  salespersons: [
    { h: "Name", cell: (r) => String(r.name) },
    { h: "Phone", cell: (r) => String(r.phone ?? "") },
    { h: "", cell: (r) => (!r.active ? <Badge label="Inactive" tone="gray" /> : null) },
  ],
  territories: [
    { h: "Name", cell: (r) => String(r.name) },
    { h: "Part of", cell: (r) => String(r.parent ?? "") },
  ],
};

export default async function MastersPage({ params, searchParams }: PageProps<"/masters/[kind]">) {
  const { kind } = await params;
  if (!isMasterKind(kind)) notFound();
  const { edit } = await searchParams;
  const [rows, opts] = await Promise.all([mastersList(kind), formOptions()]);
  const editId = Number(edit) || null;
  const editing = editId ? rows.find((r) => Number(r.id) === editId) : null;

  return (
    <>
      <PageHeader title={MASTER_TITLES[kind]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          {rows.length === 0 ? (
            <Empty>Nothing here yet. Add the first one on the right.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    {COLUMNS[kind].map((c) => (
                      <th key={c.h} className={c.num ? "num" : ""}>
                        {c.h}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={String(r.id)} className={Number(r.id) === editId ? "bg-sky-50" : "hover:bg-slate-50"}>
                      {COLUMNS[kind].map((c) => (
                        <td key={c.h} className={c.num ? "num" : ""}>
                          {c.cell(r)}
                        </td>
                      ))}
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1">
                          <Link className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50" href={`/masters/${kind}?edit=${r.id}`}>
                            Edit
                          </Link>
                          <MasterRowDelete kind={kind} id={Number(r.id)} name={String(r.name)} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={editing ? `Edit ${String(editing.name)}` : "Add new"}>
          <div className="p-4">
            <MasterForm
              key={editId ?? "new"}
              kind={kind}
              editId={editing ? editId : null}
              initial={editing ? toForm(editing) : null}
              territories={opts.territories}
              salespersons={opts.salespersons}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
