---
id: pb-01
title: "Missed-call text-back and lead capture"
slug: missed-call-text-back
type: playbook
stage: win
priority: P1
status: draft
owner_ask: "When I miss a call, text them back straight away and find out what they need."
verticals: ["plumber", "appliance-repair", "taxi", "florist", "cleaning", "salon", "landscaping"]
triggers: ["Phone system reports a call as no-answer or voicemail (telephony webhook)", "New web form, Facebook or Google Business message (same flow from step 2)"]
tables: ["Customers", "Leads", "Messages"]
integrations: ["VoIP (Twilio, RingCentral, OpenPhone)", "SMS with US 10DLC registration", "CRM or field service app (Jobber, Housecall Pro)"]
meta_models: ["muse-spark", "muse-voice-transcribe", "muse-glimmer"]
human_gates: ["Owner calls back when no reply arrives (task, not an approval)"]
kpis: ["Seconds to first response", "Share of missed calls that become booked jobs"]
mvp_coverage: partial
missing_steps: ["trigger.missedCall", "sms.send", "trigger.webhook"]
related: ["[[02-quote-approval-follow-up]]", "[[03-online-booking-intake]]", "[[15-inbox-message-triage]]"]
tags: ["playbook", "stage/win", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 01. Missed-call text-back and lead capture

> **Dad's ask:** “When I miss a call, text them back straight away and find out what they need.”

Stage: **Win the job** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Small businesses miss a large share of inbound calls, and most callers who reach voicemail ring the next business instead. Vendor surveys commonly put unanswered calls near 62% with about 85% of those callers never calling back; treat these figures as directional. A text within about a minute keeps the caller talking to you.

## Triggers

- Phone system reports a call as no-answer or voicemail (telephony webhook)
- New web form, Facebook or Google Business message (same flow from step 2)

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Missed call or voicemail event arrives with caller number and time
2. `fetch` Look the caller up in Customers by phone; mark new or existing
3. `branch` Inside business hours? Choose the in-hours or after-hours message
4. `act` Send the text-back from the same business number
5. `wait` Wait up to 15 minutes for a reply
6. `enrich` AI classifies the reply: new job, existing job, emergency, spam
7. `branch` Emergency: page owner and on-call tech. Otherwise continue
8. `store` Create or update the Lead with name, address, need, urgency and source
9. `act` Ask 2 or 3 qualifying questions, then send the booking link (playbook 03)
10. `wait` No reply after 2 hours: create an owner task to call back

## Data

- `Customers`
- `Leads`
- `Messages`

## Integrations

- VoIP (Twilio, RingCentral, OpenPhone)
- SMS with US 10DLC registration
- CRM or field service app (Jobber, Housecall Pro)

## AI steps

- Classify intent and urgency of the reply
- Draft the follow-up questions
- Transcribe voicemail (Muse Voice Transcribe)

Meta models: `muse-spark`, `muse-voice-transcribe`, `muse-glimmer`

## Human gates

- Owner calls back when no reply arrives (task, not an approval)

## KPIs

- Seconds to first response
- Share of missed calls that become booked jobs

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.email -> table.query(Customers) -> ai.classify(intent, urgency) -> table.upsert(Leads) -> ai.write(reply) -> approval.ask -> gmail.draftReply
```

The MVP has no phone or SMS steps. The Gmail variant treats a new enquiry email as the missed call: classify, save the lead and draft the reply. Phone and SMS come after the hackathon.

Steps to add to the catalog: `trigger.missedCall`, `sms.send`, `trigger.webhook`.

## Failure modes

- Replies land in a shared inbox nobody owns: every run must end with a named owner or task
- Texting landlines or blocked numbers: check the line type before sending
- Double contact when the owner calls back while the bot is texting: pause the run on any outbound call to that number
- Messaging without consent or outside quiet hours: enforce opt-out and quiet hours in the engine

## Related

- [[02-quote-approval-follow-up]]
- [[03-online-booking-intake]]
- [[15-inbox-message-triage]]
