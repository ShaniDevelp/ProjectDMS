/**
 * Demo data for a small Rawalpindi FMCG distributor. Wipes the dev DB first.
 * Usage: npm run db:seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";

const { db, pool } = await import("../src/db/index.ts");
const M = await import("../src/server/masters.ts");
const P = await import("../src/server/purchasing.ts");
const S = await import("../src/server/selling.ts");
const I = await import("../src/server/inventory.ts");
const { addDays, today } = await import("../src/server/util.ts");

const tables = await db.execute<{ tablename: string }>(
  sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`,
);
await db.execute(sql.raw(`TRUNCATE ${tables.rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`));

const t = today();
const godown = await M.saveWarehouse({ name: "Main Godown", kind: "godown" });
const van1 = await M.saveWarehouse({ name: "Van-1 (LEA-1234)", kind: "van" });
await M.saveWarehouse({ name: "Van-2 (RIM-5678)", kind: "van" });

const rwp = await M.saveTerritory({ name: "Rawalpindi" });
const saddar = await M.saveTerritory({ name: "Saddar", parentId: rwp.id });
const sat = await M.saveTerritory({ name: "Satellite Town", parentId: rwp.id });

const ali = await M.saveSalesperson({ name: "Ali Raza", phone: "0300-1111111" });
const usman = await M.saveSalesperson({ name: "Usman Khan", phone: "0301-2222222" });

const abc = await M.saveSupplier({ name: "ABC Foods (Pvt) Ltd", phone: "051-1234567" });
const pure = await M.saveSupplier({ name: "PureOil Industries", phone: "042-7654321" });

const tea = await M.saveItem({ code: "TEA-950", name: "Tea 950g", pcsPerCarton: 12, buyRate: 1650, sellRate: 1780, reorderLevel: 60 });
const bisc = await M.saveItem({ code: "BSC-12", name: "Biscuit Family Pack", pcsPerCarton: 24, buyRate: 95, sellRate: 110, reorderLevel: 96 });
const oil = await M.saveItem({ code: "OIL-5L", name: "Cooking Oil 5L", pcsPerCarton: 4, hasBatch: true, buyRate: 2650, sellRate: 2850, reorderLevel: 20 });
const soap = await M.saveItem({ code: "SOAP-100", name: "Bath Soap 100g", pcsPerCarton: 72, buyRate: 62, sellRate: 75, reorderLevel: 144 });

const bilal = await M.saveCustomer({ name: "Bilal General Store", ownerName: "Bilal Ahmed", phone: "0333-1000001", territoryId: saddar.id, salespersonId: ali.id, creditLimit: 150000, creditDays: 15 });
const madina = await M.saveCustomer({ name: "Madina Karyana", ownerName: "Haji Aslam", phone: "0333-1000002", territoryId: saddar.id, salespersonId: ali.id, creditLimit: 80000, creditDays: 7 });
const city = await M.saveCustomer({ name: "City Mart", ownerName: "Faisal", phone: "0333-1000003", territoryId: sat.id, salespersonId: usman.id, creditLimit: 300000, creditDays: 30 });
await M.saveCustomer({ name: "Rehman Cash & Carry", ownerName: "Abdul Rehman", territoryId: sat.id, salespersonId: usman.id, creditLimit: 0, creditDays: 0 });

// Opening stock for soap, then a purchase order for tea/biscuits received short.
const open = await I.createStockAdjustment({ warehouseId: godown.id, reason: "opening", lines: [{ itemId: soap.id, qtyChange: 720, rate: 62 }] });
await I.submitStockAdjustment(open.id);

const po = await P.createPurchaseOrder({
  supplierId: abc.id,
  warehouseId: godown.id,
  date: addDays(t, -10),
  lines: [
    { itemId: tea.id, qty: 240, rate: 1650 },
    { itemId: bisc.id, qty: 480, rate: 95 },
  ],
});
await P.submitPurchaseOrder(po.id);
const poLines = (await db.execute<{ id: number; item_id: number }>(sql`SELECT id, item_id FROM po_lines WHERE po_id = ${po.id} ORDER BY id`)).rows;
const grn = await P.createGrn({
  supplierId: abc.id,
  poId: po.id,
  warehouseId: godown.id,
  date: addDays(t, -8),
  supplierRef: "DC-4471",
  lines: [
    { poLineId: poLines[0].id, itemId: tea.id, qty: 216, rejectedQty: 0, rate: 1650 },
    { poLineId: poLines[1].id, itemId: bisc.id, qty: 456, rejectedQty: 24, rate: 95 },
  ],
});
await P.submitGrn(grn.id);
const grnLines = (await db.execute<{ id: number; qty: number; rate: string }>(sql`SELECT id, qty, rate FROM grn_lines WHERE grn_id = ${grn.id} ORDER BY id`)).rows;
const bill = await P.createPurchaseBill({
  supplierId: abc.id,
  grnId: grn.id,
  date: addDays(t, -8),
  dueDate: addDays(t, 22),
  supplierBillNo: "ABC-INV-9921",
  lines: grnLines.map((l) => ({ grnLineId: l.id, qty: l.qty, rate: Number(l.rate) })),
});
await P.submitPurchaseBill(bill.id);
const pay = await P.createSupplierPayment({ supplierId: abc.id, amount: 200000, method: "bank", reference: "IBFT-55120", date: addDays(t, -5) });
await P.submitSupplierPayment(pay.id);

// Oil arrives in two batches with different expiry.
const oilGrn = await P.createGrn({
  supplierId: pure.id,
  warehouseId: godown.id,
  date: addDays(t, -6),
  lines: [
    { itemId: oil.id, qty: 40, rate: 2650, batchNo: "PO-2401", expiryDate: addDays(t, 45) },
    { itemId: oil.id, qty: 40, rate: 2700, batchNo: "PO-2407", expiryDate: addDays(t, 200) },
  ],
});
await P.submitGrn(oilGrn.id);

// Van loading for Ali's route.
const load = await I.createStockTransfer({ fromWarehouseId: godown.id, toWarehouseId: van1.id, date: addDays(t, -1), lines: [{ itemId: soap.id, qty: 144 }] });
await I.submitStockTransfer(load.id);

// Orders → invoices → collections.
async function orderAndInvoice(customerId: number, date: string, lines: { itemId: number; qty: number; rate: number }[], deliverAll = true) {
  const so = await S.createSalesOrder({ customerId, warehouseId: godown.id, date, lines });
  await S.submitSalesOrder(so.id);
  const sl = (await db.execute<{ id: number; item_id: number; qty: number; rate: string }>(sql`SELECT id, item_id, qty, rate FROM so_lines WHERE so_id = ${so.id} ORDER BY id`)).rows;
  const inv = await S.createSalesInvoice({
    customerId,
    soId: so.id,
    warehouseId: godown.id,
    date,
    lines: sl.map((l, i) => ({ soLineId: l.id, itemId: l.item_id, qty: deliverAll || i > 0 ? l.qty : Math.floor(l.qty / 2), rate: Number(l.rate) })),
  });
  await S.submitSalesInvoice(inv.id);
  return { so, inv };
}

const a = await orderAndInvoice(bilal.id, addDays(t, -20), [
  { itemId: tea.id, qty: 24, rate: 1780 },
  { itemId: bisc.id, qty: 48, rate: 110 },
]);
const b = await orderAndInvoice(madina.id, addDays(t, -4), [
  { itemId: oil.id, qty: 8, rate: 2850 },
  { itemId: soap.id, qty: 72, rate: 75 },
]);
await orderAndInvoice(city.id, t, [
  { itemId: tea.id, qty: 60, rate: 1760 },
  { itemId: oil.id, qty: 12, rate: 2830 },
], false);

const rc = await S.createReceipt({ customerId: bilal.id, amount: 25000, method: "cash", date: addDays(t, -2) });
await S.submitReceipt(rc.id);
const rc2 = await S.createReceipt({ customerId: madina.id, amount: b.inv.total, method: "cheque", reference: "HBL-000123", date: t });
await S.submitReceipt(rc2.id);

// An open order waiting for delivery.
const pending = await S.createSalesOrder({ customerId: city.id, salespersonId: usman.id, warehouseId: godown.id, lines: [{ itemId: bisc.id, qty: 96, rate: 108 }] });
await S.submitSalesOrder(pending.id);

console.log("Seeded demo data. Overdue example:", a.inv.no);
await pool.end();
