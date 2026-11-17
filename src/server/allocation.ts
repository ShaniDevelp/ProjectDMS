import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { DomainError, round2, toNum } from "./util";
import type { PartyType } from "./party";

export type OpenDoc = { id: number; outstanding: number; dueDate: string | null; date: string };

/** Open invoices/bills for a party, oldest due first. */
export async function openDocs(db: DbOrTx, partyType: PartyType, partyId: number, docType: string): Promise<OpenDoc[]> {
  const res = await db.execute<{ id: number; outstanding: string; due_date: string | null; date: string }>(sql`
    SELECT against_id AS id, sum(amount) AS outstanding, min(due_date)::text AS due_date, min(date)::text AS date
    FROM party_ledger
    WHERE party_type = ${partyType} AND party_id = ${partyId} AND against_type = ${docType}
    GROUP BY against_id
    HAVING sum(amount) > 0
    ORDER BY min(due_date) ASC NULLS FIRST, min(date) ASC, against_id ASC`);
  return res.rows.map((r) => ({ id: Number(r.id), outstanding: round2(toNum(r.outstanding)), dueDate: r.due_date, date: r.date }));
}

/** Spread `amount` over open docs, oldest due first. */
export function autoAllocate(amount: number, docs: OpenDoc[]) {
  const out: { docId: number; amount: number }[] = [];
  let left = round2(amount);
  for (const d of docs) {
    if (left <= 0) break;
    const take = round2(Math.min(left, d.outstanding));
    if (take > 0) out.push({ docId: d.id, amount: take });
    left = round2(left - take);
  }
  return out;
}

/** Validate manual allocations against current outstanding. */
export function checkAllocations(amount: number, allocs: { docId: number; amount: number }[], docs: OpenDoc[], label: string) {
  const byId = new Map(docs.map((d) => [d.id, d.outstanding]));
  let sum = 0;
  for (const a of allocs) {
    if (a.amount <= 0) throw new DomainError("Allocated amounts must be positive");
    const open = byId.get(a.docId) ?? 0;
    if (round2(a.amount) > open) throw new DomainError(`Allocation ${a.amount} exceeds open amount ${open} on ${label} #${a.docId}`);
    sum = round2(sum + a.amount);
  }
  if (sum > round2(amount)) throw new DomainError(`Allocated ${sum} is more than the amount ${amount}`);
  return sum;
}
