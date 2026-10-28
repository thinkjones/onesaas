---
id: pb-15
title: "Inbox and message triage"
slug: inbox-message-triage
type: playbook
stage: keep
priority: P2
status: draft
owner_ask: "Sort my messages, answer the easy ones and tell me which ones need me."
verticals: ["all"]
triggers: ["New email, SMS, WhatsApp, web chat or social DM"]
tables: ["Messages", "Customers"]
integrations: ["Gmail or Outlook", "SMS", "WhatsApp Business", "Meta inbox"]
meta_models: ["muse-glimmer", "muse-spark"]
human_gates: ["Owner approves replies below the confidence threshold"]
kpis: ["Median first-reply time", "Messages unanswered over 24 hours"]
mvp_coverage: full
missing_steps: []
related: ["[[01-missed-call-text-back]]", "[[03-online-booking-intake]]", "[[11-overdue-dunning]]", "[[20-owner-digest]]"]
tags: ["playbook", "stage/keep", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 15. Inbox and message triage

> **Dad's ask:** “Sort my messages, answer the easy ones and tell me which ones need me.”

Stage: **Keep the customer** · Priority: **P2** · MVP coverage: **full**

## Why it matters

Enquiries, complaints, supplier mail and invoices arrive in one inbox and several messaging apps. Triage is where the other playbooks start.

## Triggers

- New email, SMS, WhatsApp, web chat or social DM

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` New message
2. `enrich` Triage model screens out spam and newsletters (Glimmer, local)
3. `fetch` Merge into one thread per customer
4. `enrich` AI classifies: booking, quote, complaint, invoice question, supplier
5. `branch` Known FAQ: draft the reply; send or ask by confidence
6. `branch` Action needed: hand to the matching playbook (01, 03, 11)
7. `wait` Reply SLA timer
8. `act` Escalate to the owner if unanswered

## Data

- `Messages`
- `Customers`

## Integrations

- Gmail or Outlook
- SMS
- WhatsApp Business
- Meta inbox

## AI steps

- Classify, extract and draft

Meta models: `muse-glimmer`, `muse-spark`

## Human gates

- Owner approves replies below the confidence threshold

## KPIs

- Median first-reply time
- Messages unanswered over 24 hours

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.email -> ai.classify(category) -> table.upsert(Customers) -> ai.write(reply) -> approval.ask -> gmail.draftReply
```

This is demo flow 1 with Glimmer triage. It runs in the MVP on a real Gmail inbox.

## Failure modes

- Auto-replying to a complaint: complaints always go to the owner
- Threads from the same customer on two channels: merge by phone and email

## Related

- [[01-missed-call-text-back]]
- [[03-online-booking-intake]]
- [[11-overdue-dunning]]
- [[20-owner-digest]]
