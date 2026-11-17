import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db";
import { partyLedger } from "@/db/schema";
import { m, round2, toNum } from "./util";

export type PartyType = "customer" | "supplier";

export async function postParty(
  tx: Tx,
  row: {
    date: string;
    partyType: PartyType;
    partyId: number;
    amount: number;
    voucherType: string;
    voucherId: number;
    againstType: string;
    againstId: number;
    dueDate?: string | null;
  },
) {
  if (round2(row.amount) === 0) return;
  await tx.insert(partyLedger).values({ ...row, amount: m(row.amount), dueDate: row.dueDate ?? null });
}

/** Cancel a voucher's AR/AP effect by appending negated mirror rows. */
export async function reverseParty(tx: Tx, voucherType: string, voucherId: number, date: string) {
  const rows = await tx
    .select()
    .from(partyLedger)
    .where(and(eq(partyLedger.voucherType, voucherType), eq(partyLedger.voucherId, voucherId), isNull(partyLedger.reversesId)))
    .orderBy(desc(partyLedger.id));
  for (const row of rows) {
    await tx.insert(partyLedger).values({
      date,
      partyType: row.partyType,
      partyId: row.partyId,
      amount: m(-toNum(row.amount)),
      voucherType,
      voucherId,
      againstType: row.againstType,
      againstId: row.againstId,
      dueDate: row.dueDate,
      reversesId: row.id,
    });
  }
}

/** Open amount on one document (invoice/bill), or unallocated credit on a receipt/payment (negative). */
export async function outstanding(db: DbOrTx, againstType: string, againstId: number): Promise<number> {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(${partyLedger.amount}), 0)` })
    .from(partyLedger)
    .where(and(eq(partyLedger.againstType, againstType), eq(partyLedger.againstId, againstId)));
  return round2(toNum(row.s));
}

/** Net balance with a party. Customer: + = owes us. Supplier: + = we owe them. */
export async function partyBalance(db: DbOrTx, partyType: PartyType, partyId: number): Promise<number> {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(${partyLedger.amount}), 0)` })
    .from(partyLedger)
    .where(and(eq(partyLedger.partyType, partyType), eq(partyLedger.partyId, partyId)));
  return round2(toNum(row.s));
}
