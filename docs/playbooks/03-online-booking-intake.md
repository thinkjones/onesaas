---
id: pb-03
title: "Online booking and intake"
slug: online-booking-intake
type: playbook
stage: win
priority: P1
status: draft
owner_ask: "Let customers book themselves in and tell me what's wrong before I turn up."
verticals: ["salon", "cleaning", "appliance-repair", "taxi", "plumber"]
triggers: ["Customer picks a slot on the booking page", "Booking request arrives by email", "Quote approved (playbook 02)"]
tables: ["Customers", "Bookings", "Jobs"]
integrations: ["Google Calendar or Microsoft 365", "Calendly or Square Appointments", "Field service app"]
meta_models: ["muse-spark", "sam-3.1"]
human_gates: ["Owner approves bookings outside normal hours or zones"]
kpis: ["Share of bookings made online", "Booking abandonment"]
mvp_coverage: full
missing_steps: []
related: ["[[02-quote-approval-follow-up]]", "[[04-confirmations-reminders]]", "[[05-dispatch-assignment]]"]
tags: ["playbook", "stage/win", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 03. Online booking and intake

> **Dad's ask:** “Let customers book themselves in and tell me what's wrong before I turn up.”

Stage: **Win the job** · Priority: **P1** · MVP coverage: **full**

## Why it matters

Self-booking takes scheduling off the owner's phone and captures the details the tech needs. Scheduling vendors report online self-booking cuts no-shows compared with phone-only booking.

## Triggers

- Customer picks a slot on the booking page
- Booking request arrives by email
- Quote approved (playbook 02)

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Booking request arrives
2. `enrich` AI extracts date, time, timezone, address and the problem
3. `fetch` Check calendar free/busy, travel zone and staff skills
4. `branch` Slot free? Hold it. Otherwise offer the next three free slots
5. `act` Send the intake form: address, photos, make and model, access notes
6. `branch` Deposit policy applies? Take a card or deposit
7. `store` Create the Booking and Job
8. `act` Create the calendar event and notify the assigned person
9. `act` Draft the confirmation to the customer

## Data

- `Customers`
- `Bookings`
- `Jobs`

## Integrations

- Google Calendar or Microsoft 365
- Calendly or Square Appointments
- Field service app

## AI steps

- Extract booking details from free text
- Read model and fault from photos
- Suggest job length and parts to bring

Meta models: `muse-spark`, `sam-3.1`

## Human gates

- Owner approves bookings outside normal hours or zones

## KPIs

- Share of bookings made online
- Booking abandonment

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.email -> ai.classify(is booking?) -> ai.extract(date, time, tz) -> calendar.freeBusy -> table.insert(Bookings) -> calendar.createEvent + gmail.draftReply
```

This is demo flow 2 in the design spec. It runs end to end in the MVP through Gmail and Calendar.

## Failure modes

- Timezone mistakes: always store the timezone and show it in the confirmation
- Double booking when two requests race: hold the slot before replying
- Free text with no date (“sometime next week”): ask, do not guess

## Related

- [[02-quote-approval-follow-up]]
- [[04-confirmations-reminders]]
- [[05-dispatch-assignment]]
