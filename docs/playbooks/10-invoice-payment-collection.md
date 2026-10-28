---
id: pb-10
title: "Invoice and payment collection"
slug: invoice-payment-collection
type: playbook
stage: paid
priority: P1
status: draft
owner_ask: "Send the bill as soon as the job's done and make it easy to pay."
verticals: ["all"]
triggers: ["Job complete (playbook 06)", "Order delivered", "Recurring billing date"]
tables: ["Invoices", "Payments", "Jobs"]
integrations: ["QuickBooks Online or Xero", "Stripe or Square", "Field service app"]
meta_models: ["muse-spark"]
human_gates: ["Owner approves invoices the AI flags"]
kpis: ["Days sales outstanding", "Share paid on the day of service"]
mvp_coverage: partial
missing_steps: ["payment.link", "payment.charge", "accounting.sync", "trigger.webhook"]
related: ["[[06-job-completion-proof-of-work]]", "[[11-overdue-dunning]]", "[[14-review-request-response]]", "[[12-expense-receipt-capture]]"]
tags: ["playbook", "stage/paid", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 10. Invoice and payment collection

> **Dad's ask:** “Send the bill as soon as the job's done and make it easy to pay.”

Stage: **Get paid** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Invoices sent late get paid late. Xero data shows US small businesses were paid about 9 days late on average in Q1 2026. A pay link in every message speeds collection.

## Triggers

- Job complete (playbook 06)
- Order delivered
- Recurring billing date

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Work complete
2. `fetch` Load job lines, parts and time
3. `enrich` AI checks the invoice against the quote and job notes; flags missing lines
4. `branch` Card on file: charge it. Otherwise send the invoice with a pay link
5. `wait` Payment webhook
6. `store` Mark paid and record fees
7. `act` Send the receipt
8. `act` Sync to accounting
9. `subflow` Start the review request (playbook 14)

## Data

- `Invoices`
- `Payments`
- `Jobs`

## Integrations

- QuickBooks Online or Xero
- Stripe or Square
- Field service app

## AI steps

- Check the invoice against quote and job notes

Meta models: `muse-spark`

## Human gates

- Owner approves invoices the AI flags

## KPIs

- Days sales outstanding
- Share paid on the day of service

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.manual -> table.query(Jobs) -> ai.write(invoice email) -> table.insert(Invoices) -> approval.ask -> gmail.draftReply
```

The MVP can draft the invoice email and record it; payments and accounting sync come later.

Steps to add to the catalog: `payment.link`, `payment.charge`, `accounting.sync`, `trigger.webhook`.

## Failure modes

- Charging the wrong card or amount: owner gate for any charge over a set amount
- Invoice never sent because the job was not closed: daily sweep for done-but-not-invoiced jobs

## Related

- [[06-job-completion-proof-of-work]]
- [[11-overdue-dunning]]
- [[14-review-request-response]]
- [[12-expense-receipt-capture]]
