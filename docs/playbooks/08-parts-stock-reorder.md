---
id: pb-08
title: "Parts and stock reorder"
slug: parts-stock-reorder
type: playbook
stage: do
priority: P2
status: draft
owner_ask: "Tell me before I run out, and order the part when a job needs it."
verticals: ["appliance-repair", "florist", "auto", "plumber"]
triggers: ["Stock below the reorder point", "Job needs a part not in stock"]
tables: ["Stock", "Suppliers", "PurchaseOrders"]
integrations: ["Inventory or POS", "Supplier portals or email", "Accounting"]
meta_models: ["muse-spark", "sam-3.1"]
human_gates: ["Owner approves orders over the spend limit"]
kpis: ["Stock-outs per month", "Days a job waits on parts"]
mvp_coverage: partial
missing_steps: ["supplier.quote", "wait.untilEvent"]
related: ["[[06-job-completion-proof-of-work]]", "[[09-supplier-po-warranty-claims]]", "[[03-online-booking-intake]]"]
tags: ["playbook", "stage/do", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 08. Parts and stock reorder

> **Dad's ask:** “Tell me before I run out, and order the part when a job needs it.”

Stage: **Do the job** · Priority: **P2** · MVP coverage: **partial**

## Why it matters

A job waiting on a part means a second visit and an unhappy customer. Seasonal shops need stock ahead of peak days.

## Triggers

- Stock below the reorder point
- Job needs a part not in stock

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Low stock or part needed
2. `enrich` AI matches the part description or photo to supplier SKUs
3. `fetch` Get price and lead time from 2 or 3 suppliers
4. `branch` Under the spend limit: order automatically. Otherwise owner approves
5. `act` Place the order
6. `wait` Until the shipment arrives
7. `store` Receive and update stock
8. `branch` Linked to a job: rebook the customer (playbook 03)

## Data

- `Stock`
- `Suppliers`
- `PurchaseOrders`

## Integrations

- Inventory or POS
- Supplier portals or email
- Accounting

## AI steps

- Match free text or a photo to supplier SKUs
- Forecast seasonal demand

Meta models: `muse-spark`, `sam-3.1`

## Human gates

- Owner approves orders over the spend limit

## KPIs

- Stock-outs per month
- Days a job waits on parts

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule -> table.query(Stock below reorder) -> ai.write(order email) -> approval.ask -> gmail.draftReply
```

The MVP can run a daily low-stock check and draft supplier order emails.

Steps to add to the catalog: `supplier.quote`, `wait.untilEvent`.

## Failure modes

- Wrong part ordered from a fuzzy match: show the match confidence and the supplier's description
- Auto-order loops when stock is not updated: one open order per SKU

## Related

- [[06-job-completion-proof-of-work]]
- [[09-supplier-po-warranty-claims]]
- [[03-online-booking-intake]]
