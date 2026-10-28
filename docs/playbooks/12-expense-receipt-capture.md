---
id: pb-12
title: "Expense and receipt capture to books"
slug: expense-receipt-capture
type: playbook
stage: paid
priority: P2
status: draft
owner_ask: "Snap the receipt and let it go into the books by itself."
verticals: ["all"]
triggers: ["Receipt photo uploaded", "Bill forwarded by email", "New bank feed line"]
tables: ["Expenses", "Jobs"]
integrations: ["Email inbox", "Bank feeds", "QuickBooks or Xero"]
meta_models: ["muse-spark"]
human_gates: ["Owner confirms low-confidence matches"]
kpis: ["Unreconciled transactions at month end"]
mvp_coverage: full
missing_steps: []
related: ["[[10-invoice-payment-collection]]", "[[13-timesheets-to-payroll]]", "[[20-owner-digest]]"]
tags: ["playbook", "stage/paid", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 12. Expense and receipt capture to books

> **Dad's ask:** “Snap the receipt and let it go into the books by itself.”

Stage: **Get paid** · Priority: **P2** · MVP coverage: **full**

## Why it matters

Receipts in the van and bills in the inbox become a month-end scramble. Matching them to bank lines and jobs as they arrive keeps the books current and shows true job cost.

## Triggers

- Receipt photo uploaded
- Bill forwarded by email
- New bank feed line

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Receipt or bill arrives
2. `enrich` Extract vendor, date, total and tax
3. `fetch` Find the matching bank transaction
4. `enrich` AI suggests the category and job
5. `branch` Low confidence: owner confirms
6. `act` Post to accounting with the image attached

## Data

- `Expenses`
- `Jobs`

## Integrations

- Email inbox
- Bank feeds
- QuickBooks or Xero

## AI steps

- Extract fields from photos and PDFs
- Categorise and assign to a job

Meta models: `muse-spark`

## Human gates

- Owner confirms low-confidence matches

## KPIs

- Unreconciled transactions at month end

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.upload -> ai.extract(vendor, date, total, tax) -> ai.classify(category, job) -> approval.ask -> table.insert(Expenses)
```

Runs in the MVP as an upload-to-table flow; posting to accounting comes later.

## Failure modes

- Duplicate receipts (photo plus emailed copy): dedupe on vendor, date and total
- Personal spend mixed in: let the owner mark it personal in one tap

## Related

- [[10-invoice-payment-collection]]
- [[13-timesheets-to-payroll]]
- [[20-owner-digest]]
