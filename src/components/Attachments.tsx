"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DocKind } from "@/lib/docs-meta";
import { Modal } from "./Modal";

export const MAX_BYTES = 10 * 1024 * 1024;

export type Meta = { id: number; fileName: string; mimeType: string; size: number; createdAt: string };
/** What the list and preview need, for both not-yet-uploaded and saved files. */
export type View = { key: string; name: string; mime: string; size: number; url: string; downloadUrl: string };

export function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(mime);

export function fileBadge(name: string, mime: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (mime === "application/pdf" || ext === "pdf") return { label: "PDF", cls: "bg-red-50 text-red-700" };
  if (/^(docx?|odt|rtf)$/.test(ext)) return { label: "DOC", cls: "bg-blue-50 text-blue-700" };
  if (/^(xlsx?|ods|csv)$/.test(ext)) return { label: "XLS", cls: "bg-emerald-50 text-emerald-700" };
  if (mime.startsWith("video/")) return { label: "VID", cls: "bg-violet-50 text-violet-700" };
  if (mime.startsWith("audio/")) return { label: "AUD", cls: "bg-violet-50 text-violet-700" };
  return { label: (ext || "FILE").slice(0, 4).toUpperCase(), cls: "bg-slate-100 text-slate-600" };
}

/** Upload files to a saved document, one request each. Returns error messages (empty = all good). */
export async function uploadFiles(kind: DocKind, id: number, files: File[]): Promise<string[]> {
  const errors: string[] = [];
  for (const f of files) {
    const body = new FormData();
    body.set("kind", kind);
    body.set("id", String(id));
    body.set("file", f);
    try {
      const res = await fetch("/api/attachments", { method: "POST", body });
      if (!res.ok) errors.push(`${f.name}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? "upload failed"}`);
    } catch {
      errors.push(`${f.name}: upload failed`);
    }
  }
  return errors;
}

/** Split picked files into accepted ones and too-large ones. */
function accept(files: FileList | File[]) {
  const ok: File[] = [];
  const bad: string[] = [];
  for (const f of Array.from(files)) {
    if (f.size > MAX_BYTES) bad.push(`${f.name} is ${fmtSize(f.size)}. Max is 10 MB.`);
    else if (f.size === 0) bad.push(`${f.name} is empty.`);
    else ok.push(f);
  }
  return { ok, bad };
}

// ───────────────────────── building blocks ─────────────────────────

function DropZone({ onFiles, busy }: { onFiles: (files: FileList) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
        over ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:border-sky-300 hover:bg-slate-50"
      }`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-400" aria-hidden>
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-sm text-slate-700">
        {busy ? "Uploading…" : (
          <>
            <span className="font-medium text-sky-700">Click to upload</span> or drag files here
          </>
        )}
      </div>
      <div className="text-xs text-slate-500">Photos, PDF, Word, Excel or any file · up to 10 MB each</div>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function FileList({ files, onOpen, onRemove, removing }: { files: View[]; onOpen: (f: View) => void; onRemove?: (f: View) => void; removing?: string | null }) {
  if (!files.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((f) => {
        const badge = fileBadge(f.name, f.mime);
        return (
          <li key={f.key} className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 hover:border-sky-300">
            <button type="button" onClick={() => onOpen(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Click to preview">
              {isImage(f.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt="" className="h-11 w-11 shrink-0 rounded-md border border-slate-100 object-cover" />
              ) : (
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800 group-hover:text-sky-700">{f.name}</span>
                <span className="block text-xs text-slate-500">{fmtSize(f.size)} · click to preview</span>
              </span>
            </button>
            {onRemove && (
              <button
                type="button"
                disabled={removing === f.key}
                onClick={() => onRemove(f)}
                className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                title="Remove"
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The preview itself (image / PDF / player / download card), without the popup frame. */
export function PreviewBody({ file }: { file: View }) {
  const m = file.mime;
  return isImage(m) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={file.url} alt={file.name} className="mx-auto max-h-[70vh] rounded-md object-contain" />
  ) : m === "application/pdf" ? (
    <iframe src={file.url} title={file.name} className="h-[70vh] w-full rounded-md border border-slate-200" />
  ) : m.startsWith("video/") ? (
    <video src={file.url} controls className="mx-auto max-h-[70vh] w-full rounded-md bg-black" />
  ) : m.startsWith("audio/") ? (
    <audio src={file.url} controls className="w-full" />
  ) : m === "text/plain" ? (
    <iframe src={file.url} title={file.name} sandbox="" className="h-[60vh] w-full rounded-md border border-slate-200 bg-white" />
  ) : (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className={`flex h-16 w-16 items-center justify-center rounded-xl text-sm font-bold ${fileBadge(file.name, m).cls}`}>{fileBadge(file.name, m).label}</span>
      <p className="text-sm text-slate-600">This file type can&apos;t be previewed in the browser.</p>
      <a href={file.downloadUrl} download={file.name} className="btn-primary">
        Download to open
      </a>
    </div>
  );
}

export function FileLinks({ file }: { file: View }) {
  return (
    <span className="flex items-center gap-3">
      {fmtSize(file.size)}
      <a href={file.downloadUrl} download={file.name} className="font-medium text-sky-700 hover:underline">
        Download
      </a>
      <a href={file.url} target="_blank" rel="noreferrer" className="font-medium text-sky-700 hover:underline">
        Open in new tab
      </a>
    </span>
  );
}

function Preview({ file, onClose }: { file: View | null; onClose: () => void }) {
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      wide
      title={<span className="break-all">{file?.name}</span>}
      subtitle={file && <FileLinks file={file} />}
    >
      {file && <PreviewBody file={file} />}
    </Modal>
  );
}

// ───────────────────────── on a new-document form (before it is saved) ─────────────────────────

/** Holds picked files locally; the form uploads them with `uploadFiles` once the document has an id. */
export function PendingAttachments({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<View | null>(null);

  // Object URLs for local preview; revoked when the list changes or the form unmounts.
  const views = useMemo<View[]>(
    () =>
      files.map((f, i) => {
        const url = URL.createObjectURL(f);
        return { key: `${i}-${f.name}-${f.size}`, name: f.name, mime: f.type || "application/octet-stream", size: f.size, url, downloadUrl: url };
      }),
    [files],
  );
  useEffect(() => () => views.forEach((v) => URL.revokeObjectURL(v.url)), [views]);

  return (
    <div className="space-y-3">
      <DropZone
        onFiles={(fl) => {
          const { ok, bad } = accept(fl);
          setErrors(bad);
          if (ok.length) onChange([...files, ...ok]);
        }}
      />
      {errors.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
      <FileList files={views} onOpen={setOpen} onRemove={(v) => onChange(files.filter((_, i) => views[i].key !== v.key))} />
      <Preview file={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ───────────────────────── on a saved document ─────────────────────────

export const savedView = (a: Meta): View => ({
  key: String(a.id),
  name: a.fileName,
  mime: a.mimeType,
  size: a.size,
  url: `/api/attachments/${a.id}`,
  downloadUrl: `/api/attachments/${a.id}?download=1`,
});

export function DocAttachments({ kind, id, initial }: { kind: DocKind; id: number; initial: Meta[] }) {
  const [list, setList] = useState<Meta[]>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<View | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const refresh = async () => {
    const res = await fetch(`/api/attachments?kind=${kind}&id=${id}`, { cache: "no-store" });
    if (res.ok) setList(await res.json());
  };

  const add = (fl: FileList) =>
    start(async () => {
      const { ok, bad } = accept(fl);
      const failed = ok.length ? await uploadFiles(kind, id, ok) : [];
      setErrors([...bad, ...failed]);
      await refresh();
    });

  const remove = async (v: View) => {
    if (!confirm(`Remove ${v.name}?`)) return;
    setRemoving(v.key);
    const res = await fetch(`/api/attachments/${v.key}`, { method: "DELETE" });
    setRemoving(null);
    if (res.ok) setList((l) => l.filter((a) => String(a.id) !== v.key));
    else setErrors([`Could not remove ${v.name}`]);
  };

  return (
    <div className="space-y-3 p-4">
      <FileList files={list.map(savedView)} onOpen={setOpen} onRemove={remove} removing={removing} />
      {list.length === 0 && <p className="text-sm text-slate-500">No proof attached yet.</p>}
      <DropZone onFiles={add} busy={busy} />
      {errors.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
      <Preview file={open} onClose={() => setOpen(null)} />
    </div>
  );
}
