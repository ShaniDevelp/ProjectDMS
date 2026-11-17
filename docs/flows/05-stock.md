# 5. Stock (Inventory)

Sidebar: **Stock**. Screens: Stock Balance, Transfers (Van Loading), Adjustments, Stock Ledger.

## 5.1 Where stock comes from and goes

```mermaid
flowchart LR
    GRN["Goods Receipt"] -- "+ IN" --> GD[("Godown")]
    ADJp["Adjustment +<br/>(opening, count gain)"] -- "+ IN" --> GD
    GD -- "Transfer<br/>(van loading)" --> VAN[("Van")]
    VAN -- "Transfer<br/>(unload)" --> GD
    GD -- "− OUT" --> SI["Sales Invoice"]
    VAN -- "− OUT" --> SI
    SR["Sales Return<br/>(good items)"] -- "+ IN" --> GD
    GD -- "− OUT" --> ADJm["Adjustment −<br/>(damage, expiry, count loss)"]
```

Every movement is one row in the **Stock Ledger** (item × warehouse × batch). Rows are never edited or deleted. Cancelling a document adds reverse rows.

## 5.2 Key rules

| Rule | Meaning for staff |
|---|---|
| **No negative stock** | You can't invoice or transfer more than is physically there. Do the GRN first |
| **Quantities in pieces** | Forms take cartons + pieces and convert automatically |
| **Moving-average cost** | Each warehouse keeps an average cost per item. Profit on invoices uses this cost |
| **FEFO for batch items** | First-Expiry-First-Out. Sales and transfers automatically take the batch expiring soonest |
| **Expired stock can't be sold** | Expired batches are skipped on sale. Write them off with an Adjustment |
| **Posting date = today** | Stock entries can't be back-dated |

## 5.3 FEFO batch picking (automatic)

```mermaid
flowchart TD
    A["Invoice line: 50 pcs of Item X<br/>from Van 1"] --> B["List batches of Item X in Van 1<br/>with stock > 0"]
    B --> C["Drop expired batches"]
    C --> D["Sort by expiry date, earliest first"]
    D --> E["Take from 1st batch,<br/>then 2nd, ... until 50 pcs"]
    E --> F{"Enough non-expired<br/>stock?"}
    F -- No --> X["Error: 'Not enough non-expired stock'"]
    F -- Yes --> OK["Stock OUT per batch<br/>batches remembered on the invoice<br/>(used later for returns)"]
```

## 5.4 Stock Transfer (van loading / unloading)

```mermaid
sequenceDiagram
    participant O as Office / Godown keeper
    participant G as Godown
    participant V as Van
    participant S as Salesman

    Note over O,S: Morning
    O->>O: Stock → Transfers → New<br/>From = Godown, To = Van 1
    O->>O: Add items (cartons + pieces)
    O->>G: Submit
    G->>V: Stock moves (FEFO batches, same cost)
    S->>S: Loads van, starts route

    Note over O,S: During day: invoices draw stock from Van 1

    Note over O,S: Evening
    S->>O: Returns with unsold stock
    O->>O: New Transfer<br/>From = Van 1, To = Godown
    O->>V: Submit
    V->>G: Unsold stock back
    O->>O: Stock Balance: Van 1 should now be ~0
```

- From and To must be different.
- For batch items you can pick a batch, or leave it blank and FEFO picks for you.
- A transfer never changes total stock **value**. The cost moves with the goods.

## 5.5 Stock Adjustment

Used to correct the system to match reality.

| Reason | Use it when | Direction |
|---|---|---|
| **Opening** | Day-one stock entry | + |
| **Count** | Physical count differs from the system | + or − |
| **Damage** | Broken, leaking, rat-damaged goods | − |
| **Expiry** | Writing off expired stock | − |
| **Other** | Anything else (give remarks) | + or − |

```mermaid
flowchart TD
    A["Stock → Adjustments → New"] --> B["Pick warehouse + reason"]
    B --> C["Each line: item, qty change (+ / −)<br/>batch (optional), rate (for +)"]
    C --> D["Submit"]
    D --> E{"Qty change"}
    E -- "+ (adding)" --> P["Batch item: batch no + expiry required<br/>Rate: entered → else current average<br/>→ else item buy rate"]
    E -- "− (removing)" --> M["Batch picked or FEFO<br/>Expired batches allowed for<br/>Expiry / Damage / Count"]
    P --> OK["Stock ledger updated"]
    M --> OK
```

## 5.6 Recommended stock routine

```mermaid
flowchart LR
    D["Daily:<br/>load vans in the morning,<br/>unload in the evening"] --> W["Weekly:<br/>check Stock Balance for<br/>near-expiry batches,<br/>sell them first / return to company"]
    W --> M["Monthly:<br/>full physical count,<br/>Adjustment = Count"]
    M --> E["Write off expired<br/>and damaged stock<br/>(Adjustment = Expiry / Damage)"]
```

## 5.7 Stock reports

- **Stock Balance:** qty and value per item per warehouse, batches with expiry dates.
- **Stock Ledger:** every movement of one item, with running qty and cost. Use it to answer "where did this stock go?"
