import Link from "next/link";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { arAging } from "@/server/queries";

const n = (v: unknown) => Number(v ?? 0);
const BUCKETS = [
  ["not_due", "Not due"],
  ["d1_15", "1–15 days late"],
  ["d16_30", "16–30"],
  ["d31_60", "31–60"],
  ["d60_plus", "60+"],
] as const;

export default async function AgingPage() {
  const rows = await arAging();
  const sum = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
  return (
    <>
      <PageHeader title="Receivables (Aging)" subtitle="Who owes how much, and how late. Negative = advance paid by the shop." />
      <Card>
        {rows.length === 0 ? (
          <Empty>No one owes anything.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Area</th>
                  <th>Salesperson</th>
                  {BUCKETS.map(([k, l]) => (
                    <th key={k} className="num">
                      {l}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Limit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)}>
                    <td>
                      <Link className="text-sky-700 hover:underline" href={`/customers/${r.id}`}>
                        {String(r.name)}
                      </Link>
                    </td>
                    <td>{String(r.territory ?? "")}</td>
                    <td>{String(r.salesperson ?? "")}</td>
                    {BUCKETS.map(([k]) => (
                      <td key={k} className={`num ${k !== "not_due" && n(r[k]) > 0 ? "text-red-700" : ""}`}>
                        {n(r[k]) ? <Money v={n(r[k])} /> : ""}
                      </td>
                    ))}
                    <td className="num font-semibold">
                      <Money v={n(r.total)} />
                    </td>
                    <td className={`num text-xs ${r.credit_limit !== null && n(r.total) > n(r.credit_limit) ? "text-red-700" : "text-slate-500"}`}>
                      {r.credit_limit === null ? "—" : <Money v={n(r.credit_limit)} />}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={3}>Total</td>
                  {BUCKETS.map(([k]) => (
                    <td key={k} className="num">
                      <Money v={sum(k)} />
                    </td>
                  ))}
                  <td className="num">
                    <Money v={sum("total")} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
