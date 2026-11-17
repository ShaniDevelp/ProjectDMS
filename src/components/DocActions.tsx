"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { docAction } from "@/app/actions";
import { docHref, type DocKind } from "@/lib/docs-meta";

export type NextStep = { kind: DocKind; label: string };

export function DocActions({
  kind,
  id,
  status,
  closed,
  next,
  printable,
}: {
  kind: DocKind;
  id: number;
  status: string;
  closed?: boolean;
  next: NextStep[];
  printable?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canClose = kind === "purchase_order" || kind === "sales_order";

  const run = (action: Parameters<typeof docAction>[2], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      setError(null);
      const res = await docAction(kind, id, action);
      if (!res.ok) return setError(res.error);
      if (action === "delete") router.push(docHref(kind));
      else router.replace(docHref(kind, id)); // drops any ?err= banner
      router.refresh();
    });
  };

  return (
    <div className="no-print flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "draft" && (
          <>
            <button className="btn-primary" disabled={pending} onClick={() => run("submit")}>
              Confirm
            </button>
            <button className="btn-danger" disabled={pending} onClick={() => run("delete", "Delete this draft?")}>
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
          <button className="btn" disabled={pending} onClick={() => run(closed ? "reopen" : "close")}>
            {closed ? "Reopen" : "Close (stop delivery)"}
          </button>
        )}
        {status === "submitted" && printable && (
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
        )}
        {status === "submitted" && (
          <button className="btn-danger" disabled={pending} onClick={() => run("cancel", "Cancel this document? Its stock and money effect will be reversed.")}>
            Cancel
          </button>
        )}
      </div>
      {error && <div className="max-w-xl rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </div>
  );
}
