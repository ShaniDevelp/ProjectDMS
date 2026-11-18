import { NextResponse, type NextRequest } from "next/server";
import { isDocKind } from "@/lib/docs-meta";
import { listAttachments } from "@/server/attachments";
import { getDoc } from "@/server/queries";

/** GET /api/docs/supplier_payment/2 → document + attachments, for the quick-view popup. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/docs/[kind]/[id]">) {
  const { kind, id } = await ctx.params;
  if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document type" }, { status: 404 });
  const [doc, files] = await Promise.all([getDoc(kind, Number(id)), listAttachments(kind, Number(id))]);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...doc, files });
}
