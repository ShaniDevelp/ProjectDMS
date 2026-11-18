import { NextResponse, type NextRequest } from "next/server";
import { deleteAttachment, getAttachment } from "@/server/attachments";
import { DomainError } from "@/server/util";

/** Types the browser may show inline. Everything else is served as a download. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|application\/pdf|text\/plain|video\/[\w.+-]+|audio\/[\w.+-]+)$/i;

/** GET /api/attachments/12 → file bytes. Add ?download=1 to force a download. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/attachments/[id]">) {
  const { id } = await ctx.params;
  const a = await getAttachment(Number(id));
  if (!a) return new NextResponse("Not found", { status: 404 });

  const inline = INLINE.test(a.mimeType) && req.nextUrl.searchParams.get("download") !== "1";
  const name = encodeURIComponent(a.fileName);
  const headers: Record<string, string> = {
    "Content-Type": inline ? a.mimeType : "application/octet-stream",
    "Content-Length": String(a.data.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
  // Uploaded files are untrusted: never let them run script on our origin.
  // (Chrome's PDF viewer refuses to load under a sandbox CSP, so PDFs are left out.)
  if (a.mimeType !== "application/pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
  return new NextResponse(new Uint8Array(a.data), { headers });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/attachments/[id]">) {
  const { id } = await ctx.params;
  try {
    await deleteAttachment(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
