"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMasterAction } from "@/app/actions";
import type { MasterKind } from "@/lib/docs-meta";

type Opt = { id: number; name: string };
type FieldDef =
  | { k: string; label: string; type: "text" | "number"; required?: boolean; hint?: string }
  | { k: string; label: string; type: "bool"; hint?: string }
  | { k: string; label: string; type: "select"; options: { value: string; label: string }[] };

function fields(kind: MasterKind, o: { territories: Opt[]; salespersons: Opt[] }): FieldDef[] {
  const opt = (xs: Opt[]) => [{ value: "", label: "—" }, ...xs.map((x) => ({ value: String(x.id), label: x.name }))];
  switch (kind) {
    case "items":
      return [
        { k: "code", label: "Code / SKU", type: "text", required: true },
        { k: "name", label: "Name", type: "text", required: true },
        { k: "pcsPerCarton", label: "Pieces per carton", type: "number", hint: "1 if sold only by piece" },
        { k: "buyRate", label: "Buying rate / piece", type: "number" },
        { k: "sellRate", label: "Selling rate / piece", type: "number" },
        { k: "reorderLevel", label: "Reorder level (pcs)", type: "number", hint: "Low-stock alert below this" },
        { k: "hasBatch", label: "Track batch & expiry", type: "bool" },
        { k: "active", label: "Active", type: "bool" },
      ];
    case "customers":
      return [
        { k: "name", label: "Shop name", type: "text", required: true },
        { k: "ownerName", label: "Owner", type: "text" },
        { k: "phone", label: "Phone", type: "text" },
        { k: "address", label: "Address", type: "text" },
        { k: "territoryId", label: "Territory", type: "select", options: opt(o.territories) },
        { k: "salespersonId", label: "Salesperson", type: "select", options: opt(o.salespersons) },
        { k: "creditLimit", label: "Credit limit (Rs)", type: "number", hint: "Empty = no limit, 0 = cash only" },
        { k: "creditDays", label: "Credit days", type: "number", hint: "Bill due after this many days" },
        { k: "creditOverride", label: "Allow over credit limit", type: "bool" },
        { k: "blocked", label: "Blocked", type: "bool" },
      ];
    case "suppliers":
      return [
        { k: "name", label: "Name", type: "text", required: true },
        { k: "phone", label: "Phone", type: "text" },
        { k: "address", label: "Address", type: "text" },
      ];
    case "warehouses":
      return [
        { k: "name", label: "Name", type: "text", required: true },
        {
          k: "kind",
          label: "Type",
          type: "select",
          options: [
            { value: "godown", label: "Godown" },
            { value: "van", label: "Delivery van" },
          ],
        },
        { k: "active", label: "Active", type: "bool" },
      ];
    case "salespersons":
      return [
        { k: "name", label: "Name", type: "text", required: true },
        { k: "phone", label: "Phone", type: "text" },
        { k: "active", label: "Active", type: "bool" },
      ];
    case "territories":
      return [
        { k: "name", label: "Name", type: "text", required: true },
        { k: "parentId", label: "Part of", type: "select", options: opt(o.territories) },
      ];
  }
}

const DEFAULTS: Record<string, unknown> = { active: true, pcsPerCarton: 1, kind: "godown", creditDays: 0 };

export function MasterForm({
  kind,
  initial,
  editId,
  territories,
  salespersons,
}: {
  kind: MasterKind;
  initial: Record<string, unknown> | null;
  editId: number | null;
  territories: Opt[];
  salespersons: Opt[];
}) {
  const router = useRouter();
  const defs = fields(kind, { territories, salespersons });
  const [v, setV] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {};
    for (const f of defs) base[f.k] = initial?.[f.k] ?? DEFAULTS[f.k] ?? (f.type === "bool" ? false : "");
    return base;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await saveMasterAction(kind, v, editId ?? undefined);
      if (!res.ok) return setError(res.error);
      router.push(`/masters/${kind}`);
      router.refresh();
      if (!editId) setV(() => Object.fromEntries(defs.map((f) => [f.k, DEFAULTS[f.k] ?? (f.type === "bool" ? false : "")])));
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {defs.map((f) => (
        <div key={f.k}>
          {f.type === "bool" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(v[f.k])} onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.checked }))} />
              {f.label}
            </label>
          ) : (
            <>
              <label className="label">
                {f.label}
                {"required" in f && f.required ? " *" : ""}
              </label>
              {f.type === "select" ? (
                <select className="input" value={String(v[f.k] ?? "")} onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.value }))}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={String(v[f.k] ?? "")}
                  onChange={(e) => setV((s) => ({ ...s, [f.k]: e.target.value }))}
                />
              )}
              {"hint" in f && f.hint && <div className="mt-0.5 text-xs text-slate-500">{f.hint}</div>}
            </>
          )}
        </div>
      ))}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : editId ? "Save changes" : "Add"}
        </button>
        {editId && (
          <button type="button" className="btn" onClick={() => router.push(`/masters/${kind}`)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
