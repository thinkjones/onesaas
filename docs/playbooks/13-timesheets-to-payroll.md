---
id: pb-13
title: "Timesheets to payroll"
slug: timesheets-to-payroll
type: playbook
stage: paid
priority: P2
status: draft
owner_ask: "Add up everyone's hours and get payroll ready for me to check."
verticals: ["taxi", "cleaning", "plumber", "salon", "any business with staff"]
triggers: ["Pay-period end"]
tables: ["Shifts", "Staff", "PayRuns"]
integrations: ["Gusto, ADP Run or QuickBooks Payroll", "Field service time tracking"]
meta_models: ["muse-spark"]
human_gates: ["Owner approves hours before payroll"]
kpis: ["Time to run payroll", "Payroll corrections per period"]
mvp_coverage: partial
missing_steps: ["payroll.submit", "accounting.sync"]
related: ["[[12-expense-receipt-capture]]", "[[18-staff-onboarding-offboarding]]", "[[20-owner-digest]]"]
tags: ["playbook", "stage/paid", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 13. Timesheets to payroll

> **Dad's ask:** “Add up everyone's hours and get payroll ready for me to check.”

Stage: **Get paid** · Priority: **P2** · MVP coverage: **partial**

## Why it matters

Hours scattered across the app, texts and paper make payroll slow and error-prone. Catching a missed clock-out before the pay run is cheaper than correcting it after.

## Triggers

- Pay-period end

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Pay-period end
2. `fetch` Collect clock-ins from the app and job records
3. `enrich` Flag gaps, overtime, missed breaks and mileage
4. `enrich` AI explains each anomaly in plain words
5. `gate` Owner approves hours
6. `act` Push hours to payroll
7. `wait` Payroll confirmation
8. `act` Post the journal to accounting and notify staff

## Data

- `Shifts`
- `Staff`
- `PayRuns`

## Integrations

- Gusto, ADP Run or QuickBooks Payroll
- Field service time tracking

## AI steps

- Explain anomalies (“Sam has 14 hours on Tuesday, likely a missed clock-out”)

Meta models: `muse-spark`

## Human gates

- Owner approves hours before payroll

## KPIs

- Time to run payroll
- Payroll corrections per period

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule(pay period) -> table.query(Shifts) -> code.transform(totals) -> ai.write(anomaly notes) -> approval.ask -> notify
```

The MVP can total hours and explain anomalies; submitting to payroll comes later.

Steps to add to the catalog: `payroll.submit`, `accounting.sync`.

## Failure modes

- Paying unapproved hours: payroll push only after the owner gate
- Tips or mileage missed: separate line types in Shifts

## Related

- [[12-expense-receipt-capture]]
- [[18-staff-onboarding-offboarding]]
- [[20-owner-digest]]
