import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { isDocKind } from "@/lib/docs-meta";
import { DomainError } from "./util";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentMeta = { id: number; fileName: string; mimeType: string; size: number; createdAt: string };

const metaCols = {
  id: attachments.id,
  fileName: attachments.fileName,
  mimeType: attachments.mimeType,
  size: attachments.size,
  createdAt: attachments.createdAt,
};

const toMeta = (r: { id: number; fileName: string; mimeType: string; size: number; createdAt: Date }): AttachmentMeta => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
});

export async function listAttachments(docKind: string, docId: number): Promise<AttachmentMeta[]> {
  const rows = await db
    .select(metaCols)
    .from(attachments)
    .where(and(eq(attachments.docKind, docKind), eq(attachments.docId, docId)))
    .orderBy(desc(attachments.id));
  return rows.map(toMeta);
}

export async function addAttachment(docKind: string, docId: number, file: File): Promise<AttachmentMeta> {
  if (!isDocKind(docKind)) throw new DomainError("Unknown document type");
  if (!Number.isInteger(docId) || docId <= 0) throw new DomainError("Unknown document");
  if (file.size === 0) throw new DomainError("File is empty");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new DomainError(`${file.name} is larger than 10 MB`);
  const data = Buffer.from(await file.arrayBuffer());
  const [row] = await db
    .insert(attachments)
    .values({
      docKind,
      docId,
      fileName: (file.name || "file").slice(0, 200),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data,
    })
    .returning(metaCols);
  return toMeta(row);
}

export async function getAttachment(id: number) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row ?? null;
}

export async function deleteAttachment(id: number) {
  const res = await db.delete(attachments).where(eq(attachments.id, id)).returning({ id: attachments.id });
  if (!res.length) throw new DomainError("Attachment not found");
}
