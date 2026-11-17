# 6. Selling

Sidebar: **Selling**. Screens: Sales Orders, Sales Invoices, Sales Returns (Receipts are in [07-collections.md](07-collections.md)).

## 6.1 Flow

```mermaid
flowchart LR
    SO["<b>Sales Order</b><br/>booked at shop<br/>credit checked"] -- "Create Invoice (deliver)" --> SI["<b>Sales Invoice</b><br/>goods leave,<br/>shop owes"]
    SI -- "Create Return" --> SR["<b>Sales Return</b><br/>goods back,<br/>credit to shop"]
    SI -- "Receive payment" --> RC["<b>Receipt</b>"]

    SI -. "stock OUT (FEFO)" .-> ST[("Godown / Van")]
    SR -. "good items IN" .-> ST
    SI -. "owes +" .-> AR[("Shop balance")]
    SR -. "owes −" .-> AR
    RC -. "owes −" .-> AR
```

| Document | Stock | Shop balance | Notes |
|---|---|---|---|
| Sales Order | — | — | Credit check on submit |
| Sales Invoice | OUT | + total | Due date = date + credit days |
| Sales Return | IN (good only) | − total | At the original invoice rate |

## 6.2 Sales Order + credit check

```mermaid
flowchart TD
    A["Selling → Sales Orders → New"] --> B["Pick shop, warehouse<br/>(salesman fills from shop)"]
    B --> C["Add items: cartons + pieces, rate"]
    C --> D["Save Draft → Submit"]
    D --> K1{"Shop blocked?"}
    K1 -- Yes --> X1["Error: shop is blocked"]
    K1 -- No --> K2{"Credit override on?"}
    K2 -- Yes --> OK["Order submitted"]
    K2 -- No --> K3{"Any overdue invoice?"}
    K3 -- Yes --> X2["Error: N overdue bills, Rs X.<br/>Collect payment first."]
    K3 -- No --> K4{"Owes + open orders<br/>(incl. this one)<br/>more than credit limit?"}
    K4 -- Yes --> X3["Error: Credit limit exceeded"]
    K4 -- No --> OK
```

**Exposure** = what the shop owes now + value of its submitted orders not yet invoiced.

How to clear a block:

| Message | Fix |
|---|---|
| Overdue bills | Collect payment (Receipt), then submit again |
| Credit limit exceeded | Collect payment, reduce the order, or raise the limit in the customer master |
| Shop is blocked | Unblock in the customer master (manager decision) |

**Close (stop delivery):** if the shop no longer wants the rest of the order, Close it. Closed orders don't count toward exposure. Reopening an order re-checks the credit limit.

## 6.3 Sales Invoice (delivery + billing in one step)

```mermaid
flowchart TD
    A{"Coming from an order?"} -- Yes --> B["Open Sales Order →<br/>'Create Invoice (deliver)'<br/>pending qty pre-filled"]
    A -- "No (van spot sale)" --> C["Selling → Sales Invoices → New"]
    B --> D["Pick warehouse:<br/>Godown or the salesman's Van"]
    C --> D
    D --> E["Adjust qty to what is actually<br/>delivered (partial allowed)"]
    E --> F["Submit"]
    F --> V1{"Enough non-expired<br/>stock in that warehouse?"}
    V1 -- No --> X1["Error: not enough stock"]
    V1 -- Yes --> V2{"Invoiced more<br/>than ordered?"}
    V2 -- Yes --> X2["Error: blocked"]
    V2 -- No --> V3{"Has lines without an order?"}
    V3 -- Yes --> CC["Credit check<br/>(+ overdue check if no order at all)"]
    V3 -- No --> OK
    CC -- Fail --> X3["Error: credit"]
    CC -- Pass --> OK["Stock OUT by FEFO batches<br/>Cost & profit recorded<br/>Shop owes invoice total<br/>Due date = date + credit days"]
    OK --> P["Print invoice for the shop"]
```

- Lines from an order were already credit-checked at order time, so they aren't checked again.
- One order can have several invoices (partial deliveries).
- An invoice can't be cancelled while it has submitted returns or receipts.

## 6.4 Sales Return

```mermaid
flowchart TD
    A["Open the Sales Invoice → 'Create Return'"] --> B["Pick warehouse that receives the goods<br/>and reason: unsold / damaged / expired /<br/>wrong item / other"]
    B --> C["Each line: return qty +<br/>condition Good or Damaged"]
    C --> D["Submit"]
    D --> V{"Returned more<br/>than invoiced?"}
    V -- Yes --> X["Error: blocked"]
    V -- No --> S{"Condition"}
    S -- Good --> G["Back into stock,<br/>same batch, original cost"]
    S -- Damaged --> N["NOT added to stock<br/>(write-off / claim)"]
    G --> M["Credit = qty × invoice rate"]
    N --> M
    M --> M1["Reduces the invoice's open amount"]
    M1 --> M2{"Credit more than<br/>invoice still owes?"}
    M2 -- Yes --> M3["Extra stays as shop credit<br/>(advance)"]
    M2 -- No --> DONE["Done"]
    M3 --> DONE
```

- Returns are always linked to an invoice, so the rate and batches are exact.
- Mark **Damaged** for anything that can't be sold again. Stock stays accurate.

## 6.5 Recommended selling practice

1. **Book an order first** whenever possible. It's the credit gate.
2. **Invoice from the van warehouse** for van sales, so van stock stays accurate.
3. **Invoice only what is physically handed over.** Deliver the rest later on another invoice, or Close the order.
4. **Print and give the invoice** to the shop, and get it signed.
5. Take returns **against the original invoice** and mark the condition honestly.
6. Before a salesman's route, give him the overdue list (Receivables Aging filtered by salesman), because those shops will be blocked.
