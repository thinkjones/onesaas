---
id: pb-02
title: "Quote, approval and follow-up"
slug: quote-approval-follow-up
type: playbook
stage: win
priority: P1
status: draft
owner_ask: "Write the quote for me, send it, and chase them if they go quiet."
verticals: ["plumber", "appliance-repair", "landscaping", "events", "cleaning"]
triggers: ["Lead qualified (playbook 01) or site visit completed"]
tables: ["Leads", "Quotes", "QuoteLines", "Jobs"]
integrations: ["Field service or quoting app", "Payments (Stripe, Square)", "E-signature"]
meta_models: ["muse-spark", "muse-wonder"]
human_gates: ["Owner approves every quote before it is sent"]
kpis: ["Quote win rate", "Days from request to approval"]
mvp_coverage: partial
missing_steps: ["trigger.recordChange", "wait.until", "payment.link", "sms.send"]
related: ["[[01-missed-call-text-back]]", "[[03-online-booking-intake]]", "[[05-dispatch-assignment]]", "[[10-invoice-payment-collection]]"]
tags: ["playbook", "stage/win", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 02. Quote, approval and follow-up

> **Dad's ask:** “Write the quote for me, send it, and chase them if they go quiet.”

Stage: **Win the job** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Quotes go cold because nobody follows up. Field service leaders such as Jobber ship this as fixed rules (up to two automatic follow-ups on its Connect plan), with the same message and timing for every quote. An agent can personalise the chase for high-value jobs.

## Triggers

- Lead qualified (playbook 01) or site visit completed

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Lead marked ready to quote
2. `fetch` Pull the request, photos, past quotes and the price book
3. `enrich` AI drafts the quote with line items
4. `gate` Owner reviews and edits the quote
5. `act` Send by text and email with an approve link and optional deposit
6. `wait` 1 day after the customer first views it
7. `act` Follow-up 1
8. `wait` 5 more days
9. `act` Follow-up 2, personalised for quotes above the high-value threshold
10. `branch` Approved: take deposit, convert to a job, go to playbook 03 or 05. Declined: ask the reason, tag lost. Silent 30 days: archive

## Data

- `Leads`
- `Quotes`
- `QuoteLines`
- `Jobs`

## Integrations

- Field service or quoting app
- Payments (Stripe, Square)
- E-signature

## AI steps

- Draft the quote from the request and past work
- Write personal follow-ups for high-value quotes
- Read a decline reply and tag the reason

Meta models: `muse-spark`, `muse-wonder`

## Human gates

- Owner approves every quote before it is sent

## KPIs

- Quote win rate
- Days from request to approval

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.manual -> table.query(Leads) -> ai.write(quote) -> table.insert(Quotes) -> approval.ask -> gmail.draftReply
```

The MVP can draft and store the quote and leave the email as a Gmail draft. The timed follow-ups need a wait step and a scheduled trigger.

Steps to add to the catalog: `trigger.recordChange`, `wait.until`, `payment.link`, `sms.send`.

## Failure modes

- Price book out of date: show the date of the prices on the draft
- Follow-ups keep going after a phone acceptance: stop the run when the quote status changes anywhere
- Two systems both chase the same quote: pick one owner per quote stage

## Related

- [[01-missed-call-text-back]]
- [[03-online-booking-intake]]
- [[05-dispatch-assignment]]
- [[10-invoice-payment-collection]]
