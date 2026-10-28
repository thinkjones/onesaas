---
id: pb-07
title: "Order intake and fulfilment"
slug: order-intake-fulfilment
type: playbook
stage: do
priority: P1
status: draft
owner_ask: "Get every order from every channel into one list and make sure it goes out right."
verticals: ["florist", "bakery", "print-shop", "retail"]
triggers: ["Order from website, phone, email, walk-in, marketplace or wire service"]
tables: ["Orders", "OrderItems", "Customers", "Recipients"]
integrations: ["Shopify or Square Online", "Florist POS (FloristWare, Floranext)", "Wire networks (FTD, Teleflora, BloomNet)", "Delivery routing"]
meta_models: ["muse-spark"]
human_gates: ["Quality check photo before dispatch", "Owner approves substitutions"]
kpis: ["Orders per day against capacity", "On-time delivery", "Order error rate"]
mvp_coverage: partial
missing_steps: ["payment.link", "address.validate"]
related: ["[[05-dispatch-assignment]]", "[[08-parts-stock-reorder]]", "[[10-invoice-payment-collection]]", "[[17-seasonal-campaigns-win-back]]"]
tags: ["playbook", "stage/do", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 07. Order intake and fulfilment

> **Dad's ask:** “Get every order from every channel into one list and make sure it goes out right.”

Stage: **Do the job** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Retail and delivery shops take orders by web, phone, walk-in, marketplace and (for florists) wire service. Florist software guides stress that every channel should land in one system so nothing is lost on peak days.

## Triggers

- Order from website, phone, email, walk-in, marketplace or wire service

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Order arrives on any channel
2. `enrich` AI parses phone and email orders into a structured order
3. `enrich` Validate the delivery address and window
4. `branch` Over capacity for that date? Offer another date or stop taking orders
5. `act` Take payment
6. `store` Create the order and production ticket (recipe, card message)
7. `gate` Quality check with a photo
8. `subflow` Add to the delivery batch (playbook 05)
9. `act` Send the delivered photo to the buyer

## Data

- `Orders`
- `OrderItems`
- `Customers`
- `Recipients`

## Integrations

- Shopify or Square Online
- Florist POS (FloristWare, Floranext)
- Wire networks (FTD, Teleflora, BloomNet)
- Delivery routing

## AI steps

- Parse free-text orders
- Suggest substitutions when stock is short
- Check the card message for typos

Meta models: `muse-spark`

## Human gates

- Quality check photo before dispatch
- Owner approves substitutions

## KPIs

- Orders per day against capacity
- On-time delivery
- Order error rate

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.email -> ai.classify(is order?) -> ai.extract(order) -> table.insert(Orders) -> approval.ask -> gmail.draftReply
```

The MVP can turn order emails into rows and draft the confirmation.

Steps to add to the catalog: `payment.link`, `address.validate`.

## Failure modes

- Buyer and recipient mixed up: keep them as separate records
- Wire orders double-entered: dedupe on the wire order number
- Valentine's Day overload: hard capacity cap per date

## Related

- [[05-dispatch-assignment]]
- [[08-parts-stock-reorder]]
- [[10-invoice-payment-collection]]
- [[17-seasonal-campaigns-win-back]]
