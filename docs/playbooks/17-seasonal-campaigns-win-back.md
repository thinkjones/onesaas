---
id: pb-17
title: "Seasonal campaigns and win-back"
slug: seasonal-campaigns-win-back
type: playbook
stage: keep
priority: P3
status: draft
owner_ask: "Help me send a nice offer before the busy season and bring old customers back."
verticals: ["florist", "plumber", "hvac", "salon", "bakery"]
triggers: ["Calendar event", "Customer inactive for N months"]
tables: ["Customers", "Campaigns", "Consent"]
integrations: ["Email (Mailchimp)", "SMS", "Meta Business Suite", "CRM"]
meta_models: ["muse-spark", "muse-image", "sam-3.1"]
human_gates: ["Owner approves every campaign before it goes out"]
kpis: ["Campaign revenue", "Unsubscribe rate"]
mvp_coverage: full
missing_steps: []
related: ["[[14-review-request-response]]", "[[16-recurring-service-renewals]]", "[[07-order-intake-fulfilment]]"]
tags: ["playbook", "stage/keep", "p3"]
created: 2026-10-28
updated: 2026-10-28
---

# 17. Seasonal campaigns and win-back

> **Dad's ask:** “Help me send a nice offer before the busy season and bring old customers back.”

Stage: **Keep the customer** · Priority: **P3** · MVP coverage: **full**

## Why it matters

Valentine's, Mother's Day, first frost and AC season drive predictable demand. Past customers are the cheapest to win.

## Triggers

- Calendar event
- Customer inactive for N months

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Season date or inactivity
2. `fetch` Build the segment: past buyers, last visit, area
3. `enrich` AI drafts the offer copy and image
4. `gate` Owner approves copy, image and audience
5. `act` Send by email and SMS, respecting opt-outs and quiet hours
6. `store` Track replies and bookings
7. `act` Report campaign results to the owner

## Data

- `Customers`
- `Campaigns`
- `Consent`

## Integrations

- Email (Mailchimp)
- SMS
- Meta Business Suite
- CRM

## AI steps

- Write the copy
- Generate or edit the image
- Suggest segments

Meta models: `muse-spark`, `muse-image`, `sam-3.1`

## Human gates

- Owner approves every campaign before it goes out

## KPIs

- Campaign revenue
- Unsubscribe rate

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.upload(product photo) -> image.cutout -> image.generate -> table.insert(Posts) -> meta.draftPost
```

The social-post half is demo flow 4 in the design spec (SAM cutout plus Muse Image). The email blast comes later.

## Failure modes

- Messaging people who opted out: consent check is an engine rule, not a template step
- AI image that misrepresents the product: owner approves every image

## Related

- [[14-review-request-response]]
- [[16-recurring-service-renewals]]
- [[07-order-intake-fulfilment]]
