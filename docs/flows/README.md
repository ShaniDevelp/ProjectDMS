# DMS Flow Guide: Index

This folder explains how a distributor uses DMS, module by module, with a flow diagram for each.

| # | File | What it covers |
|---|---|---|
| 1 | [01-overall-journey.md](01-overall-journey.md) | The full journey: first-time setup, the daily routine, and how all the modules connect |
| 2 | [02-document-lifecycle.md](02-document-lifecycle.md) | Draft → Submit → Cancel rules that apply to every document |
| 3 | [03-setup-masters.md](03-setup-masters.md) | Setting up territories, salespeople, warehouses/vans, suppliers, items, customers |
| 4 | [04-buying.md](04-buying.md) | Purchase Order → Goods Receipt → Purchase Bill → Supplier Payment |
| 5 | [05-stock.md](05-stock.md) | Stock ledger, batches and expiry (FEFO), van loading, adjustments |
| 6 | [06-selling.md](06-selling.md) | Sales Order (credit check) → Sales Invoice → Sales Return |
| 7 | [07-collections.md](07-collections.md) | Receipts from shops, auto-allocation, advances, aging |
| 8 | [08-reports.md](08-reports.md) | Dashboard and all reports, and when to look at each |

## How to use the diagrams

The diagrams are written in **Mermaid**, a text format for diagrams.

- **Notion, Confluence, GitHub, GitLab, Obsidian, Azure DevOps wiki:** paste the whole Markdown file. Diagrams render automatically (in Notion and Confluence, paste each diagram into a "Mermaid" code block or diagram macro).
- **Google Docs or MS Word:** these don't render Mermaid. Open <https://mermaid.live>, paste the code from inside a ```` ```mermaid ```` block, then download it as PNG or SVG and insert the image into your document. The text sections can be pasted as normal.
