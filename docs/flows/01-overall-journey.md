# 1. Overall Journey: How a Distributor Uses DMS

DMS runs the full cycle of an FMCG distributor: **buy stock from the company → keep it in the godown → load vans → sell to shops on credit → collect money → pay the company**.

Every screen in the app belongs to one of these modules:

| Module | Sidebar group | Purpose |
|---|---|---|
| Setup (Masters) | Setup | One-time data: items, customers (shops), suppliers, warehouses/vans, salespeople, territories |
| Buying | Buying | Order stock from the company, receive it, record their bill, pay them |
| Stock | Stock | See what you have, load vans, fix counts, track expiry |
| Selling | Selling | Book orders at shops, deliver and bill, take returns |
| Collections | Selling → Receipts | Collect cash/cheque from shops |
| Reports | Dashboard, Reports | Know who owes, what's selling, what's running low |

---

## 1.1 The big picture

```mermaid
flowchart LR
    subgraph SETUP["Setup (one time)"]
        M["Items, Customers, Suppliers,<br/>Warehouses & Vans,<br/>Salespeople, Territories"]
    end

    subgraph BUY["Buying"]
        PO["Purchase Order"] --> GRN["Goods Receipt (GRN)"]
        GRN --> PB["Purchase Bill"]
        PB --> SP["Supplier Payment"]
    end

    subgraph STOCK["Stock"]
        GD[("Godown stock")]
        VAN[("Van stock")]
        GD -- "Stock Transfer<br/>(van loading)" --> VAN
        VAN -- "Stock Transfer<br/>(unload unsold)" --> GD
        ADJ["Stock Adjustment<br/>(count, damage, expiry, opening)"] -.-> GD
    end

    subgraph SELL["Selling"]
        SO["Sales Order<br/>(credit check)"] --> SI["Sales Invoice<br/>(delivers + bills)"]
        SI --> SR["Sales Return"]
    end

    subgraph COLLECT["Collections"]
        RC["Receipt<br/>(cash / bank / cheque)"]
    end

    subgraph REP["Reports"]
        R["Dashboard, Stock Balance,<br/>Aging, Sales by Salesperson,<br/>Customer Statement (khata)"]
    end

    M --> BUY
    M --> SELL
    GRN -- "stock IN" --> GD
    SI -- "stock OUT" --> VAN
    SI -- "stock OUT" --> GD
    SR -- "good stock back IN" --> GD
    SI -- "shop owes money" --> RC
    SR -- "reduces what shop owes" --> RC
    PB -- "we owe supplier" --> SP
    BUY --> REP
    STOCK --> REP
    SELL --> REP
    COLLECT --> REP
```

**Two ledgers sit behind everything:**

- **Stock ledger:** every item movement in or out of a godown or van. Rows are never edited or deleted.
- **Party ledger:** what each shop owes you (receivables) and what you owe each supplier (payables).

Documents only touch these ledgers when you **Submit** them. Drafts have no effect. See [02-document-lifecycle.md](02-document-lifecycle.md).

---

## 1.2 Stage 1: First-time setup (do once, in this order)

The order matters because later records point to earlier ones (a customer needs a territory and a salesperson, and so on).

```mermaid
flowchart TD
    A["1. Territories / Areas<br/>e.g. Saddar, Gulberg"] --> B["2. Salespeople<br/>order bookers / van salesmen"]
    B --> C["3. Warehouses & Vans<br/>main godown + one per van"]
    C --> D["4. Suppliers<br/>the companies you buy from"]
    D --> E["5. Items<br/>code, pcs per carton, batch on/off,<br/>buy rate, sell rate, reorder level"]
    E --> F["6. Customers (Shops)<br/>territory, salesperson,<br/>credit limit, credit days"]
    F --> G["7. Opening stock<br/>Stock Adjustment, reason = Opening"]
    G --> H(["Ready for daily work"])
```

Details: [03-setup-masters.md](03-setup-masters.md).

---

## 1.3 Stage 2: The recommended daily routine

This is the easiest way to run a normal day.

```mermaid
flowchart TD
    subgraph MORNING["Morning (office)"]
        D1["Open Dashboard<br/>sales, collections, overdue, low stock"] --> D2{"Any item<br/>running low?"}
        D2 -- Yes --> D3["Create Purchase Order<br/>to the company"]
        D2 -- No --> D4
        D3 --> D4["Check Receivables (Aging)<br/>give each salesman his overdue list"]
        D4 --> D5["Stock Transfer: Godown → Van<br/>(van loading)"]
    end

    subgraph FIELD["During the day (field)"]
        F1["Salesman visits shop"] --> F2["Book Sales Order<br/>credit is checked on submit"]
        F2 --> F3{"Credit OK?"}
        F3 -- "No: over limit or overdue" --> F4["Collect old payment first<br/>(Receipt), then retry"]
        F4 --> F2
        F3 -- Yes --> F5["Create Invoice from the order<br/>(goods delivered, shop owes)"]
        F5 --> F6["Shop pays now or later<br/>Receipt"]
        F6 --> F7{"Shop returns<br/>goods?"}
        F7 -- Yes --> F8["Sales Return<br/>good / damaged"]
        F7 -- No --> F9(["Next shop"])
        F8 --> F9
    end

    subgraph GODOWN["When company stock arrives"]
        G1["Goods Receipt (GRN)<br/>from the Purchase Order<br/>enter batch + expiry"] --> G2["Purchase Bill<br/>when the company's invoice comes"]
        G2 --> G3["Supplier Payment<br/>when you pay them"]
    end

    subgraph EVENING["Evening (office)"]
        E1["Stock Transfer: Van → Godown<br/>unsold stock back"] --> E2["Check Dashboard:<br/>sales today vs collected today"]
        E2 --> E3["Sales by Salesperson"]
    end

    MORNING --> FIELD --> EVENING
```

### Weekly / monthly

```mermaid
flowchart LR
    W1["Physical stock count"] --> W2["Stock Adjustment<br/>reason = Count"]
    W3["Expiry check<br/>(Stock Balance report)"] --> W4["Stock Adjustment<br/>reason = Expiry / Damage"]
    W5["Receivables (Aging)"] --> W6["Block or reduce credit<br/>for slow payers"]
    W7["Customer Statement (khata)"] --> W8["Share with shop to settle"]
```

---

## 1.4 Two ways to sell: pick one per salesman

DMS supports both common FMCG models. Pick the one that matches each salesman.

```mermaid
flowchart TB
    subgraph OB["A. Order booker + delivery (pre-sell)"]
        direction LR
        A1["Day 1: Booker takes<br/>Sales Order at shop"] --> A2["Office: Create Invoice<br/>from order, warehouse = Godown"]
        A2 --> A3["Day 2: Delivery van<br/>drops goods + invoice"]
        A3 --> A4["Receipt when<br/>shop pays"]
    end

    subgraph VS["B. Van sales (spot sale)"]
        direction LR
        B1["Morning: Transfer<br/>Godown → Van"] --> B2["At shop: Invoice<br/>warehouse = Van<br/>(order optional)"]
        B2 --> B3["Receipt on the spot"]
        B3 --> B4["Evening: Transfer<br/>Van → Godown"]
    end
```

- **Order booker model** is safest: credit is checked at order time, and the office controls invoicing.
- **Van sales model** is fastest: invoice directly from the van. An invoice without an order is still credit-checked when it is submitted.

---

## 1.5 How documents link to each other

Every next document is created **from** the previous one with a button on its page (for example "Receive goods (GRN)" on a Purchase Order). This copies the remaining quantities, so you never retype them.

```mermaid
flowchart LR
    PO["Purchase Order"] -- "Receive goods (GRN)" --> GRN["Goods Receipt"]
    GRN -- "Create Purchase Bill" --> PB["Purchase Bill"]
    PB -- "Pay supplier" --> SP["Supplier Payment"]

    SO["Sales Order"] -- "Create Invoice (deliver)" --> SI["Sales Invoice"]
    SI -- "Receive payment" --> RC["Receipt"]
    SI -- "Create Return" --> SR["Sales Return"]
```

| From | Button | Creates | Shown when |
|---|---|---|---|
| Purchase Order | Receive goods (GRN) | Goods Receipt | Order not closed and something is still not received |
| Goods Receipt | Create Purchase Bill | Purchase Bill | Something received is still not billed |
| Purchase Bill | Pay supplier | Supplier Payment | Bill still has an amount open |
| Sales Order | Create Invoice (deliver) | Sales Invoice | Order not closed and something is still not delivered |
| Sales Invoice | Receive payment | Receipt | Invoice still has an amount open |
| Sales Invoice | Create Return | Sales Return | Something invoiced is still not returned |

Partial work is allowed everywhere: you can receive half a PO today and the rest next week, or deliver part of an order now and the rest later.

---

## 1.6 Golden rules for staff

1. **Nothing counts until you Submit.** Drafts are just saved forms.
2. **To fix a mistake, Cancel and create again.** Submitted documents can't be edited. Cancelling adds reverse entries so history stays clean.
3. **Cancel in reverse order.** Cancel the Receipt before the Invoice, the Bill before the GRN, and so on.
4. **Always create the next document from the previous one** (use the buttons), so links and pending quantities stay correct.
5. **Enter quantities as cartons + pieces.** The system stores pieces and converts using the item's pieces-per-carton.
6. **Enter batch and expiry on every GRN** for batch-tracked items. Sales pick the earliest-expiry stock automatically, and expired stock can't be sold.
7. **Collect overdue money before booking new orders.** The system blocks orders for shops with overdue bills.

---

## 1.7 Not in this version (v1)

Login and user roles, the salesman mobile app, route/beat planning, delivery trips with cash settlement, trade schemes and discounts, full accounting (general ledger) and FBR tax, Urdu UI, and opening balances for old shop dues (khata carried in from before DMS).
