---
id: pb-19
title: "Licence, insurance and vehicle compliance"
slug: licence-insurance-vehicle-compliance
type: playbook
stage: run
priority: P2
status: draft
owner_ask: "Warn me before any licence, insurance or vehicle check runs out."
verticals: ["taxi", "plumber", "hvac", "electrician", "childcare"]
triggers: ["Schedule against expiry dates", "New document uploaded"]
tables: ["Documents", "Staff", "Vehicles"]
integrations: ["Document storage", "Dispatch or field service user status", "Email and SMS"]
meta_models: ["muse-spark"]
human_gates: ["Owner verifies extracted dates"]
kpis: ["Items expiring in 30 days", "Jobs assigned to non-compliant staff (target zero)"]
mvp_coverage: full
missing_steps: []
related: ["[[05-dispatch-assignment]]", "[[18-staff-onboarding-offboarding]]", "[[20-owner-digest]]"]
tags: ["playbook", "stage/run", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 19. Licence, insurance and vehicle compliance

> **Dad's ask:** “Warn me before any licence, insurance or vehicle check runs out.”

Stage: **Run the shop** · Priority: **P2** · MVP coverage: **full**

## Why it matters

A lapsed private-hire permit, liability policy or gas certificate can stop the business. These are low-frequency but high-risk.

## Triggers

- Schedule against expiry dates
- New document uploaded

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Daily expiry scan or new upload
2. `enrich` AI reads a new certificate and extracts issuer, number and expiry
3. `gate` Owner verifies the extracted dates
4. `store` Save to Documents
5. `act` At 60, 30 and 7 days before expiry: remind the holder and the owner
6. `branch` Expired: block the person from dispatch (playbook 05) until renewed

## Data

- `Documents`
- `Staff`
- `Vehicles`

## Integrations

- Document storage
- Dispatch or field service user status
- Email and SMS

## AI steps

- Extract expiry details from certificates and photos

Meta models: `muse-spark`

## Human gates

- Owner verifies extracted dates

## KPIs

- Items expiring in 30 days
- Jobs assigned to non-compliant staff (target zero)

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.upload -> ai.extract(expiry) -> approval.ask -> table.insert(Documents); trigger.schedule(daily) -> table.query(expiring) -> notify
```

Both halves run in the MVP; blocking dispatch waits for playbook 05.

## Failure modes

- Misread date format (US vs UK): owner verifies every extraction
- Reminders to a leaver: stop when staff status changes

## Related

- [[05-dispatch-assignment]]
- [[18-staff-onboarding-offboarding]]
- [[20-owner-digest]]
