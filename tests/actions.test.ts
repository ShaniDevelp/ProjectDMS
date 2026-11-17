import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDocAction, docAction, saveMasterAction } from "@/app/actions";
import { closeDb, resetDb, seedBasics } from "./helpers";

type Seed = Awaited<ReturnType<typeof seedBasics>>;
let s: Seed;

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeDb);

// Payloads below mirror what DocForm/MasterForm send: numbers as strings, empty strings, nulls.
describe("server actions with form-shaped input", () => {
  it("adjustment (opening) → sales order → invoice → receipt, then friendly errors", async () => {
    const adj = await createDocAction(
      "stock_adjustment",
      {
        date: "2026-11-01",
        remarks: null,
        warehouseId: String(s.godown.id),
        reason: "opening",
        lines: [{ itemId: String(s.tea.id), qtyChange: 24, rate: "900", batchNo: null, expiryDate: null }],
      },
      true,
    );
    expect(adj).toEqual({ ok: true, id: expect.any(Number) });

    const so = await createDocAction(
      "sales_order",
      {
        date: "2026-11-01",
        remarks: null,
        customerId: String(s.shop.id),
        salespersonId: null,
        warehouseId: String(s.godown.id),
        soId: null,
        lines: [{ soLineId: null, itemId: String(s.tea.id), qty: 14, rate: "1000" }],
      },
      true,
    );
    expect(so.ok).toBe(true);

    const inv = await createDocAction(
      "sales_invoice",
      {
        date: "2026-11-01",
        customerId: String(s.shop.id),
        salespersonId: "",
        warehouseId: String(s.godown.id),
        soId: null,
        lines: [{ soLineId: null, itemId: String(s.tea.id), qty: 30, rate: "1000" }],
      },
      true,
    );
    // Not enough stock: draft is kept and the reason is user-readable.
    expect(inv.ok).toBe(false);
    if (!inv.ok) {
      expect(inv.id).toEqual(expect.any(Number));
      expect(inv.error).toMatch(/Saved as draft.*Not enough stock of TEA950/);
      expect(await docAction("sales_invoice", inv.id!, "delete")).toEqual({ ok: true, id: inv.id });
    }

    const rc = await createDocAction(
      "receipt",
      { date: "2026-11-01", customerId: String(s.shop.id), salespersonId: null, amount: "500", method: "cash", reference: null, allocations: [] },
      true,
    );
    expect(rc.ok).toBe(true);

    const bad = await createDocAction("purchase_order", { supplierId: "", warehouseId: String(s.godown.id), lines: [] }, true);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/supplierId|Add at least one item/);
  });

  it("master save: blank credit limit means unlimited; duplicate names are friendly", async () => {
    const ok = await saveMasterAction("customers", { name: "New Shop", creditLimit: "", creditDays: "7", territoryId: "", salespersonId: "" });
    expect(ok).toEqual({ ok: true });
    const dup = await saveMasterAction("customers", { name: "New Shop", creditLimit: "", creditDays: "0" });
    expect(dup).toEqual({ ok: false, error: "That name or code already exists" });
  });
});
