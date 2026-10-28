---
id: pb-11
title: "Overdue dunning"
slug: overdue-dunning
type: playbook
stage: paid
priority: P1
status: draft
owner_ask: "Chase the people who haven't paid, politely, so I don't have to."
verticals: ["all"]
triggers: ["Daily scan for invoices near or past due"]
tables: ["Invoices", "Payments", "ContactLog"]
integrations: ["Accounting", "SMS", "Email"]
meta_models: ["muse-spark"]
human_gates: ["Owner decides at 21 and 45 days"]
kpis: ["Share overdue more than 30 days", "Amount recovered"]
mvp_coverage: partial
missing_steps: ["payment.link", "accounting.sync"]
related: ["[[10-invoice-payment-collection]]", "[[15-inbox-message-triage]]", "[[20-owner-digest]]"]
tags: ["playbook", "stage/paid", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 11. Overdue dunning

> **Dad's ask:** “Chase the people who haven't paid, politely, so I don't have to.”

Stage: **Get paid** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Intuit's 2026 report found 59% of small businesses carry invoices more than 30 days overdue, averaging $17,700 unpaid. A 2026 collections guide suggests reminders at 3, 7 and 14 days past due catch most people who simply forgot.

## Triggers

- Daily scan for invoices near or past due

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Daily scan
2. `act` 3 days before due: friendly reminder
3. `act` At 3, 7 and 14 days past due: escalating reminders with a pay link
4. `enrich` AI reads replies (“paid yesterday”, “dispute”) and routes them
5. `gate` At 21 days: owner chooses call, payment plan or pause future work
6. `gate` At 45 days: owner chooses collections or write-off

## Data

- `Invoices`
- `Payments`
- `ContactLog`

## Integrations

- Accounting
- SMS
- Email

## AI steps

- Classify replies and extract payment promises
- Adjust tone by customer value and history

Meta models: `muse-spark`

## Human gates

- Owner decides at 21 and 45 days

## KPIs

- Share overdue more than 30 days
- Amount recovered

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule(daily) -> table.query(Invoices overdue) -> ai.write(reminder by stage) -> approval.ask -> gmail.draftReply
```

The MVP can run the daily sweep and draft the right reminder for each overdue invoice.

Steps to add to the catalog: `payment.link`, `accounting.sync`.

## Failure modes

- Chasing an invoice that was paid in cash: re-check payment status before every send
- Harsh tone with a loyal customer: show the customer history on the approval card

## Related

- [[10-invoice-payment-collection]]
- [[15-inbox-message-triage]]
- [[20-owner-digest]]
