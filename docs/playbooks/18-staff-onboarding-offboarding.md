---
id: pb-18
title: "Staff onboarding and offboarding"
slug: staff-onboarding-offboarding
type: playbook
stage: run
priority: P3
status: draft
owner_ask: "When someone starts or leaves, sort the paperwork and the logins."
verticals: ["all businesses with staff"]
triggers: ["New hire accepted", "Leaver date set"]
tables: ["Staff", "Documents", "AccessList", "Checklists"]
integrations: ["Gusto or ADP", "Google Workspace or Microsoft 365", "Field service user admin", "E-signature"]
meta_models: ["muse-spark"]
human_gates: ["Owner confirms leaving dates and access removal"]
kpis: ["Days to productive", "Accounts left active after exit (target zero)"]
mvp_coverage: partial
missing_steps: ["account.provision", "account.revoke"]
related: ["[[13-timesheets-to-payroll]]", "[[19-licence-insurance-vehicle-compliance]]"]
tags: ["playbook", "stage/run", "p3"]
created: 2026-10-28
updated: 2026-10-28
---

# 18. Staff onboarding and offboarding

> **Dad's ask:** “When someone starts or leaves, sort the paperwork and the logins.”

Stage: **Run the shop** · Priority: **P3** · MVP coverage: **partial**

## Why it matters

Forms, accounts, keys and training are easy to forget in a small shop. A leaver who still has app access is a real risk.

## Triggers

- New hire accepted
- Leaver date set

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Hire or leaver event
2. `parallel` Onboarding: collect tax and right-to-work forms, create accounts, order uniform and keys
3. `act` Assign the training checklist
4. `wait` Day 7 and day 30 check-ins
5. `gate` Offboarding: owner confirms the leaving date
6. `act` Revoke all app access on the day
7. `act` Recover equipment
8. `subflow` Final pay (playbook 13)

## Data

- `Staff`
- `Documents`
- `AccessList`
- `Checklists`

## Integrations

- Gusto or ADP
- Google Workspace or Microsoft 365
- Field service user admin
- E-signature

## AI steps

- Write role-specific checklists
- Answer new-hire questions from the shop handbook

Meta models: `muse-spark`

## Human gates

- Owner confirms leaving dates and access removal

## KPIs

- Days to productive
- Accounts left active after exit (target zero)

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.manual -> ai.write(checklist) -> table.insert(Checklists) -> approval.ask -> notify
```

The MVP can generate and track the checklist; account changes stay manual.

Steps to add to the catalog: `account.provision`, `account.revoke`.

## Failure modes

- Forgotten shared passwords: list shared logins in AccessList and rotate on exit

## Related

- [[13-timesheets-to-payroll]]
- [[19-licence-insurance-vehicle-compliance]]
