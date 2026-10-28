---
id: pb-16
title: "Recurring service and renewals"
slug: recurring-service-renewals
type: playbook
stage: keep
priority: P2
status: draft
owner_ask: "Remind regulars when they're due and renew their plans without me remembering."
verticals: ["hvac", "pest", "pool", "cleaning", "landscaping", "florist subscriptions"]
triggers: ["Schedule: service interval, contract renewal date or subscription cycle"]
tables: ["ServicePlans", "Customers", "Bookings"]
integrations: ["Field service recurring jobs", "Payments", "Calendar"]
meta_models: ["muse-spark"]
human_gates: ["Owner reviews churn risks and renewal price changes"]
kpis: ["Plan retention", "Share of revenue that is recurring"]
mvp_coverage: partial
missing_steps: ["payment.charge", "wait.until"]
related: ["[[03-online-booking-intake]]", "[[04-confirmations-reminders]]", "[[17-seasonal-campaigns-win-back]]"]
tags: ["playbook", "stage/keep", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 16. Recurring service and renewals

> **Dad's ask:** “Remind regulars when they're due and renew their plans without me remembering.”

Stage: **Keep the customer** · Priority: **P2** · MVP coverage: **partial**

## Why it matters

Service plans and repeat visits are predictable revenue. They slip when nobody remembers who is due.

## Triggers

- Schedule: service interval, contract renewal date or subscription cycle

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Daily or weekly schedule
2. `fetch` Find customers due in the next 30 days
3. `act` Propose a slot
4. `branch` Accepted: book (playbook 03)
5. `wait` 7 days silent, then a second nudge
6. `branch` Contract renewal: send the renewal and charge the card on file
7. `enrich` AI ranks churn risk from history and complaints
8. `gate` Owner reviews high churn-risk customers

## Data

- `ServicePlans`
- `Customers`
- `Bookings`

## Integrations

- Field service recurring jobs
- Payments
- Calendar

## AI steps

- Rank churn risk
- Personalise the renewal message

Meta models: `muse-spark`

## Human gates

- Owner reviews churn risks and renewal price changes

## KPIs

- Plan retention
- Share of revenue that is recurring

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule(weekly) -> table.query(ServicePlans due) -> calendar.freeBusy -> ai.write(offer) -> approval.ask -> gmail.draftReply
```

The MVP can find who is due, check free slots and draft the offers.

Steps to add to the catalog: `payment.charge`, `wait.until`.

## Failure modes

- Offering a slot already taken: re-check free/busy at send time
- Renewing a customer who cancelled by phone: check status before charging

## Related

- [[03-online-booking-intake]]
- [[04-confirmations-reminders]]
- [[17-seasonal-campaigns-win-back]]
