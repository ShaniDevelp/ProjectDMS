"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { group: string; links: { href: string; label: string }[] }[] = [
  { group: "", links: [{ href: "/", label: "Dashboard" }] },
  {
    group: "Selling",
    links: [
      { href: "/docs/sales_order", label: "Sales Orders" },
      { href: "/docs/sales_invoice", label: "Sales Invoices" },
      { href: "/docs/sales_return", label: "Sales Returns" },
      { href: "/docs/receipt", label: "Receipts" },
    ],
  },
  {
    group: "Buying",
    links: [
      { href: "/docs/purchase_order", label: "Purchase Orders" },
      { href: "/docs/grn", label: "Goods Receipts" },
      { href: "/docs/purchase_bill", label: "Purchase Bills" },
      { href: "/docs/supplier_payment", label: "Supplier Payments" },
    ],
  },
  {
    group: "Stock",
    links: [
      { href: "/reports/stock", label: "Stock Balance" },
      { href: "/docs/stock_transfer", label: "Transfers (Van Loading)" },
      { href: "/docs/stock_adjustment", label: "Adjustments" },
      { href: "/reports/ledger", label: "Stock Ledger" },
    ],
  },
  {
    group: "Reports",
    links: [
      { href: "/reports/aging", label: "Receivables (Aging)" },
      { href: "/reports/sales", label: "Sales by Salesperson" },
    ],
  },
  {
    group: "Setup",
    links: [
      { href: "/masters/customers", label: "Customers" },
      { href: "/masters/items", label: "Items" },
      { href: "/masters/suppliers", label: "Suppliers" },
      { href: "/masters/warehouses", label: "Warehouses & Vans" },
      { href: "/masters/salespersons", label: "Salespeople" },
      { href: "/masters/territories", label: "Territories" },
    ],
  },
];

export function Sidebar() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto bg-slate-900 px-3 py-4 text-slate-300 md:block">
      <Link href="/" className="mb-4 block px-2 text-lg font-semibold tracking-tight text-white">
        DMS <span className="text-xs font-normal text-slate-400">distribution</span>
      </Link>
      {NAV.map((g) => (
        <div key={g.group} className="mb-3">
          {g.group && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</div>}
          {g.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-md px-2 py-1.5 text-sm ${active(l.href) ? "bg-slate-700 text-white" : "hover:bg-slate-800 hover:text-white"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      ))}
    </aside>
  );
}
