# 4. Buying (Procurement)

Sidebar: **Buying**. This covers buying stock from the company (supplier) and paying them.

## 4.1 Flow

```mermaid
flowchart LR
    PO["<b>Purchase Order</b><br/>what you asked for"] -- "Receive goods (GRN)" --> GRN["<b>Goods Receipt</b><br/>what actually arrived"]
    GRN -- "Create Purchase Bill" --> PB["<b>Purchase Bill</b><br/>company's invoice"]
    PB -- "Pay supplier" --> SP["<b>Supplier Payment</b><br/>money paid"]

    GRN -. "stock IN" .-> ST[("Godown stock")]
    PB -. "we owe +" .-> AP[("Payable to supplier")]
    SP -. "we owe −" .-> AP
```

| Step | Who | When | Effect |
|---|---|---|---|
| Purchase Order | Owner / manager | When stock is low or before company's cut-off | None. A record of what you ordered |
| Goods Receipt | Godown keeper | When the truck arrives | Accepted qty added to stock at the GRN rate |
| Purchase Bill | Accounts | When the company's invoice arrives | Amount added to what you owe the supplier |
| Supplier Payment | Owner / accounts | When you pay | Reduces what you owe |

## 4.2 Purchase Order

```mermaid
flowchart TD
    A["Buying → Purchase Orders → New"] --> B["Pick supplier + receiving warehouse"]
    B --> C["Add items: cartons + pieces, rate<br/>(rate defaults to item buy rate)"]
    C --> D["Save as Draft"]
    D --> E["Submit"]
    E --> F{"All received?"}
    F -- "Not yet" --> G["'Receive goods (GRN)' button stays available"]
    F -- "Company will not send rest" --> H["Close (stop delivery)"]
```

- A PO doesn't change stock or money.
- **Close** stops further receiving. **Reopen** allows it again.
- A PO can be cancelled only if it has no submitted GRNs.

## 4.3 Goods Receipt (GRN)

```mermaid
flowchart TD
    A["Open the Purchase Order → 'Receive goods (GRN)'"] --> B["Form is pre-filled with<br/>qty still pending"]
    B --> C["Count physically. For each line enter:<br/>• accepted qty<br/>• rejected qty (damaged / short-expiry)<br/>• batch no + expiry (batch items)"]
    C --> D["Submit"]
    D --> V1{"Received qty more<br/>than ordered?"}
    V1 -- Yes --> X["Error: blocked"]
    V1 -- No --> V2{"Batch item without<br/>batch no?"}
    V2 -- Yes --> X
    V2 -- No --> OK["Accepted qty → stock IN<br/>average cost updated<br/>PO 'received' updated"]
```

- **Rejected qty** is recorded for your claim with the company but is **not** added to stock.
- A GRN without a PO is allowed (for unplanned deliveries).
- Partial GRNs are fine. The PO keeps showing what's pending.
- The same batch number for the same item can't have two different expiry dates.
- **Cost:** stock is valued by **moving average**. Each GRN mixes its rate into the item's average cost in that warehouse.

## 4.4 Purchase Bill

```mermaid
flowchart TD
    A["Open the GRN → 'Create Purchase Bill'"] --> B["Pre-filled with qty not yet billed"]
    B --> C["Check rates against company invoice<br/>enter supplier's bill no"]
    C --> D["Submit"]
    D --> V{"Billed qty more<br/>than received?"}
    V -- Yes --> X["Error: blocked"]
    V -- No --> OK["Amount added to<br/>'We owe suppliers'"]
```

- Bill only what was **received**. This stops paying for short-supplied goods.

## 4.5 Supplier Payment

```mermaid
flowchart TD
    A["Open the Bill → 'Pay supplier'<br/>or Buying → Supplier Payments → New"] --> B["Enter amount, method<br/>(cash / bank / cheque), reference"]
    B --> C{"Choose bills manually?"}
    C -- "No (recommended)" --> D["Auto: oldest due bill paid first"]
    C -- Yes --> E["Allocate to specific bills"]
    D --> F["Submit"]
    E --> F
    F --> G["Bills reduced.<br/>Any extra stays as advance<br/>with the supplier"]
```

## 4.6 Recommended practice

1. Always start from a **PO**, even for phone orders. It makes short-supply visible.
2. Do the **GRN on the day stock arrives**, before selling it. Stock that isn't in the system can't be sold.
3. Enter **rejected qty** honestly. It's your record for claims.
4. Create the **Bill from the GRN**, never from scratch.
5. Pay with auto-allocation unless the company tells you which bill a payment is for.
