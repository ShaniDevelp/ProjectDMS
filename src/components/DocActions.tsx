"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { docAction } from "@/app/actions";
import { CANCEL_EFFECT, DOC_META, docHref, type DocKind } from "@/lib/docs-meta";
import { ConfirmDialog } from "./ConfirmDialog";
import { flashHref } from "./Flash";

export type NextStep = { kind: DocKind; label: string };
type Command = "submit" | "cancel" | "delete" | "close" | "reopen";

/**
 * Runs a document command behind a confirmation popup, shows server errors inside the popup,
 * and on success navigates with a banner explaining what happened.
 * `returnTo` = where to land afterwards ("doc" page, or the "list").
 */
export function useDocCommand(kind: DocKind, id: number, no: string, returnTo: "doc" | "list" = "doc") {
  const router = useRouter();
  const [ask, setAsk] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const title = DOC_META[kind].title;

  const run = (cmd: Command) =>
    start(async () => {
      setError(null);
      const res = await docAction(kind, id, cmd);
      if (!res.ok) {
        // Inside a popup: keep it open and show why. Without one: open an info popup with the reason.
        setError(res.error);
        setAsk((a) => a ?? cmd);
        return;
      }
      setAsk(null);
      const msg: Record<Command, string> = {
        submit: `${no} confirmed.`,
        cancel: `${title} ${no} has been cancelled. ${CANCEL_EFFECT[kind]}`,
        delete: `Draft ${no} deleted.`,
        close: `${no} closed. Nothing more will be ${kind === "sales_order" ? "delivered" : "received"} against it.`,
        reopen: `${no} reopened.`,
      };
      const target = cmd === "delete" || returnTo === "list" ? docHref(kind) : docHref(kind, id);
      router.replace(flashHref(target, msg[cmd]), { scroll: false });
      router.refresh();
    });

  const close = () => {
    setAsk(null);
    setError(null);
  };

  const dialog = (
    <>
      <ConfirmDialog
        open={ask === "delete"}
        title={`Delete draft ${no}?`}
        confirmLabel="Delete draft"
        tone="danger"
        pending={pending}
        error={error}
        onConfirm={() => run("delete")}
        onClose={close}
      >
        <p>This draft was never confirmed, so it has no effect on stock or balances.</p>
        <p>It will be removed permanently.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={ask === "cancel"}
        title={`Cancel ${title.toLowerCase()} ${no}?`}
        confirmLabel={`Yes, cancel ${no}`}
        cancelLabel="Keep it"
        tone="danger"
        pending={pending}
        error={error}
        onConfirm={() => run("cancel")}
        onClose={close}
      >
        <p className="font-medium text-slate-800">{CANCEL_EFFECT[kind]}</p>
        <p>The document stays in the list marked “Cancelled”, so your history is complete. This can’t be undone; to redo it, create a new one.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={ask === "close"}
        title={`Close ${no}?`}
        confirmLabel="Close order"
        cancelLabel="Keep open"
        tone="warning"
        pending={pending}
        error={error}
        onConfirm={() => run("close")}
        onClose={close}
      >
        <p>
          The remaining quantity will not be {kind === "sales_order" ? "delivered" : "received"}. What was already{" "}
          {kind === "sales_order" ? "invoiced" : "received"} stays as it is.
        </p>
        {kind === "sales_order" && <p>The shop’s credit held by this order is freed.</p>}
        <p>You can reopen it later.</p>
      </ConfirmDialog>

      {/* Commands without their own popup (submit / reopen) still report failures in one. */}
      <ConfirmDialog open={(ask === "submit" || ask === "reopen") && !!error} title={`Could not ${ask === "submit" ? "confirm" : "reopen"} ${no}`} tone="warning" error={error} onClose={close}>
        <p>Nothing was changed.</p>
      </ConfirmDialog>
    </>
  );

  return { ask: setAsk, run, pending, dialog };
}

export function DocActions({
  kind,
  id,
  no,
  status,
  closed,
  next,
  printable,
}: {
  kind: DocKind;
  id: number;
  no: string;
  status: string;
  closed?: boolean;
  next: NextStep[];
  printable?: boolean;
}) {
  const { ask, run, pending, dialog } = useDocCommand(kind, id, no);
  const canClose = kind === "purchase_order" || kind === "sales_order";

  return (
    <div className="no-print flex flex-wrap justify-end gap-2">
      {status === "draft" && (
        <>
          <button className="btn-primary" disabled={pending} onClick={() => run("submit")}>
            Confirm
          </button>
          <button className="btn-danger" disabled={pending} onClick={() => ask("delete")}>
            Delete draft
          </button>
        </>
      )}
      {status === "submitted" &&
        next.map((n) => (
          <Link key={n.kind} className="btn-primary" href={`${docHref(n.kind)}/new?from=${id}`}>
            {n.label}
          </Link>
        ))}
      {status === "submitted" && canClose && (
        <button className="btn" disabled={pending} onClick={() => (closed ? run("reopen") : ask("close"))}>
          {closed ? "Reopen" : "Close (stop delivery)"}
        </button>
      )}
      {status === "submitted" && printable && (
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      )}
      {status === "submitted" && (
        <button className="btn-danger" disabled={pending} onClick={() => ask("cancel")}>
          Cancel
        </button>
      )}
      {dialog}
    </div>
  );
}

/** Trash button for a list row. Drafts are deleted; confirmed documents are cancelled (never erased). */
export function DocRowDelete({ kind, id, no, status }: { kind: DocKind; id: number; no: string; status: string }) {
  const { ask, pending, dialog } = useDocCommand(kind, id, no, "list");
  const [info, setInfo] = useState(false);
  const label = status === "draft" ? `Delete draft ${no}` : status === "submitted" ? `Delete / cancel ${no}` : `${no} is cancelled`;

  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={pending}
        onClick={() => (status === "draft" ? ask("delete") : setInfo(true))}
        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <TrashIcon />
      </button>

      <ConfirmDialog
        open={info && status === "submitted"}
        title={`${no} can’t be deleted`}
        tone="warning"
        confirmLabel={`Cancel ${no} instead`}
        cancelLabel="Go back"
        onConfirm={() => {
          setInfo(false);
          ask("cancel");
        }}
        onClose={() => setInfo(false)}
      >
        <p>It is already confirmed, so it has changed stock or balances. Deleting it would leave your books wrong.</p>
        <p>
          <b className="text-slate-800">Cancel</b> it instead: {CANCEL_EFFECT[kind].charAt(0).toLowerCase() + CANCEL_EFFECT[kind].slice(1)} It stays in the
          list marked “Cancelled” for your records.
        </p>
      </ConfirmDialog>

      <ConfirmDialog open={info && status === "cancelled"} title={`${no} is already cancelled`} tone="info" onClose={() => setInfo(false)}>
        <p>Its effect on stock and balances has already been reversed.</p>
        <p>Cancelled documents are kept for your history and can’t be deleted.</p>
      </ConfirmDialog>

      {dialog}
    </>
  );
}

export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
