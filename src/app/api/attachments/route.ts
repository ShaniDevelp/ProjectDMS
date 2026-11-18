import { NextResponse, type NextRequest } from "next/server";
import { addAttachment, listAttachments } from "@/server/attachments";
import { DomainError } from "@/server/util";

/** GET /api/attachments?kind=receipt&id=12 → metadata list. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  const id = Number(req.nextUrl.searchParams.get("id"));
  return NextResponse.json(await listAttachments(kind, id));
}

/** POST multipart: kind, id, file (one file per request, max 10 MB). */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file sent" }, { status: 400 });
    const meta = await addAttachment(String(form.get("kind") ?? ""), Number(form.get("id")), file);
    return NextResponse.json(meta, { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
