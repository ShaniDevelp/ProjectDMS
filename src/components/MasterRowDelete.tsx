"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteMasterAction } from "@/app/actions";
import { MASTER_TITLES, type MasterKind } from "@/lib/docs-meta";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./DocActions";
import { flashHref } from "./Flash";

const SINGULAR: Record<MasterKind, string> = {
  customers: "customer",
  items: "item",
  suppliers: "supplier",
  warehouses: "warehouse",
  salespersons: "salesperson",
  territories: "area",
};

/** Delete button for a Setup row. Records already used in documents are refused by the server with a reason. */
export function MasterRowDelete({ kind, id, name }: { kind: MasterKind; id: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      setError(null);
      const res = await deleteMasterAction(kind, id);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.replace(flashHref(`/masters/${kind}`, `${name} deleted from ${MASTER_TITLES[kind]}.`), { scroll: false });
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        title={`Delete ${name}`}
        aria-label={`Delete ${name}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <TrashIcon />
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete ${SINGULAR[kind]} “${name}”?`}
        confirmLabel="Delete"
        tone="danger"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      >
        <p>It will be removed from {MASTER_TITLES[kind]} permanently.</p>
        <p className="text-xs text-slate-500">Only records that were never used can be deleted. If it appears on any order, invoice or stock entry, you’ll be told how to retire it instead.</p>
      </ConfirmDialog>
    </>
  );
}
