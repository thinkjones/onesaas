---
id: pb-09
title: "Supplier PO and warranty claims"
slug: supplier-po-warranty-claims
type: playbook
stage: do
priority: P3
status: draft
owner_ask: "Put together the warranty claim and keep chasing it until we get paid."
verticals: ["appliance-repair", "hvac", "auto"]
triggers: ["Purchase approved", "Job flagged as manufacturer warranty"]
tables: ["Claims", "PurchaseOrders", "Jobs"]
integrations: ["Email", "Manufacturer portals (often browser-only)", "Accounting"]
meta_models: ["muse-spark"]
human_gates: ["Owner approves every claim before submission"]
kpis: ["Claim approval rate", "Days to reimbursement"]
mvp_coverage: partial
missing_steps: ["browser.fillForm", "wait.until"]
related: ["[[06-job-completion-proof-of-work]]", "[[08-parts-stock-reorder]]", "[[02-quote-approval-follow-up]]"]
tags: ["playbook", "stage/do", "p3"]
created: 2026-10-28
updated: 2026-10-28
---

# 09. Supplier PO and warranty claims

> **Dad's ask:** “Put together the warranty claim and keep chasing it until we get paid.”

Stage: **Do the job** · Priority: **P3** · MVP coverage: **partial**

## Why it matters

Manufacturer warranty work is money owed to the shop that often goes unclaimed because the paperwork is tedious.

## Triggers

- Purchase approved
- Job flagged as manufacturer warranty

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Warranty job or approved purchase
2. `enrich` AI builds the claim pack: serial, purchase date, fault, photos
3. `gate` Owner approves the claim or PO
4. `act` Submit to the supplier or manufacturer portal
5. `wait` 5 days
6. `act` Chase, repeating until resolved or 4 chases
7. `enrich` AI reads the reply and extracts approval or rejection reason
8. `branch` Approved: book the reimbursement in accounting. Rejected: tell the customer and offer a paid repair quote (playbook 02)

## Data

- `Claims`
- `PurchaseOrders`
- `Jobs`

## Integrations

- Email
- Manufacturer portals (often browser-only)
- Accounting

## AI steps

- Assemble the claim from the job record
- Read rejection emails and extract the reason

Meta models: `muse-spark`

## Human gates

- Owner approves every claim before submission

## KPIs

- Claim approval rate
- Days to reimbursement

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.manual -> table.query(Jobs) -> ai.write(claim) -> table.insert(Claims) -> approval.ask -> gmail.draftReply
```

The MVP can draft the claim email; portal submission needs browser automation.

Steps to add to the catalog: `browser.fillForm`, `wait.until`.

## Failure modes

- Claim missing the serial number: block submission until present
- Chasing after payment arrived: check accounting before each chase

## Related

- [[06-job-completion-proof-of-work]]
- [[08-parts-stock-reorder]]
- [[02-quote-approval-follow-up]]
