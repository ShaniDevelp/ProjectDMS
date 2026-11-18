"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";

const TONE = {
  danger: { icon: "bg-red-100 text-red-600", btn: "inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" },
  warning: { icon: "bg-amber-100 text-amber-600", btn: "inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50" },
  info: { icon: "bg-sky-100 text-sky-600", btn: "btn-primary px-4" },
} as const;

/**
 * Yes/no popup for destructive or important actions. Shows the server's error inside the
 * popup (so the user sees *why* it failed) instead of closing it.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Go back",
  tone = "danger",
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Omit to show an information-only popup with a single close button. */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: keyof typeof TONE;
  pending?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const t = TONE[tone];
  return (
    <Modal open={open} onClose={() => !pending && onClose()} title={title}>
      <div className="flex gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${t.icon}`} aria-hidden>
          {tone === "info" ? <InfoIcon /> : <WarnIcon />}
        </span>
        <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-600">{children}</div>
      </div>
      {error && (
        <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <WarnIcon small />
          <span>{error}</span>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" className="btn" disabled={pending} onClick={onClose}>
          {confirmLabel ? cancelLabel : "Close"}
        </button>
        {confirmLabel && onConfirm && (
          <button type="button" className={t.btn} disabled={pending} onClick={onConfirm} autoFocus>
            {pending ? "Working…" : confirmLabel}
          </button>
        )}
      </div>
    </Modal>
  );
}

function WarnIcon({ small = false }: { small?: boolean }) {
  const s = small ? 16 : 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0" aria-hidden>
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5m0-3h.01" strokeLinecap="round" />
    </svg>
  );
}
