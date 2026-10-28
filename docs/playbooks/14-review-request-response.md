---
id: pb-14
title: "Review request and response"
slug: review-request-response
type: playbook
stage: keep
priority: P1
status: draft
owner_ask: "Ask happy customers for a review, and help me answer the ones that come in."
verticals: ["all"]
triggers: ["Job closed or invoice paid", "New public review posted"]
tables: ["Reviews", "Customers", "Jobs"]
integrations: ["Google Business Profile", "Facebook", "Yelp", "SMS"]
meta_models: ["muse-spark"]
human_gates: ["Owner approves every public reply"]
kpis: ["New reviews per month", "Average rating", "Reply rate"]
mvp_coverage: partial
missing_steps: ["review.fetch", "review.reply", "sms.send"]
related: ["[[10-invoice-payment-collection]]", "[[15-inbox-message-triage]]", "[[17-seasonal-campaigns-win-back]]"]
tags: ["playbook", "stage/keep", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 14. Review request and response

> **Dad's ask:** “Ask happy customers for a review, and help me answer the ones that come in.”

Stage: **Keep the customer** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

BrightLocal's 2026 survey found 97% of consumers read reviews for local businesses, across about six review sites, and AI tools jumped to 45% of local-business discovery. Fresh reviews feed both Google and LLM answers.

## Triggers

- Job closed or invoice paid
- New public review posted

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Job closed or paid
2. `wait` 2 hours
3. `act` Short satisfaction check (1 to 5)
4. `act` Send the Google review link to everyone
5. `wait` 3 days, then one reminder
6. `branch` Low score: alert the owner privately and open a recovery task
7. `trigger` New public review arrives (second entry point)
8. `enrich` AI drafts a reply in the owner's voice
9. `gate` Owner approves the reply
10. `act` Post the reply

## Data

- `Reviews`
- `Customers`
- `Jobs`

## Integrations

- Google Business Profile
- Facebook
- Yelp
- SMS

## AI steps

- Draft replies in the owner's voice
- Tag sentiment and themes

Meta models: `muse-spark`

## Human gates

- Owner approves every public reply

## KPIs

- New reviews per month
- Average rating
- Reply rate

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.manual(job closed) -> table.query(Customers) -> ai.write(review ask) -> approval.ask -> gmail.draftReply
```

The MVP can draft review-request emails. Reading and replying to Google reviews needs a new adapter.

Steps to add to the catalog: `review.fetch`, `review.reply`, `sms.send`.

## Failure modes

- Review gating (only asking happy customers): Google policy and the US FTC rule on fake reviews restrict it, so the link goes to everyone
- Incentives for reviews: do not offer them
- Replies that leak private job details: the AI must not mention addresses, prices or problems the reviewer did not mention

## Related

- [[10-invoice-payment-collection]]
- [[15-inbox-message-triage]]
- [[17-seasonal-campaigns-win-back]]
