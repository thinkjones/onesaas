---
id: pb-04
title: "Confirmations and reminders"
slug: confirmations-reminders
type: playbook
stage: win
priority: P1
status: draft
owner_ask: "Remind people about their appointment so they actually turn up."
verticals: ["salon", "cleaning", "plumber", "appliance-repair", "taxi"]
triggers: ["Appointment created or changed", "Scheduled sweep each morning"]
tables: ["Bookings", "Waitlist"]
integrations: ["SMS", "Email", "Calendar", "Field service app"]
meta_models: ["muse-spark"]
human_gates: ["Owner approves reschedules the AI proposes"]
kpis: ["No-show rate", "Share confirmed 24 hours before"]
mvp_coverage: partial
missing_steps: ["sms.send", "wait.until", "trigger.recordChange"]
related: ["[[03-online-booking-intake]]", "[[05-dispatch-assignment]]", "[[15-inbox-message-triage]]"]
tags: ["playbook", "stage/win", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 04. Confirmations and reminders

> **Dad's ask:** “Remind people about their appointment so they actually turn up.”

Stage: **Win the job** · Priority: **P1** · MVP coverage: **partial**

## Why it matters

Forgetting is the top reason for no-shows. A scheduling vendor cites a Cochrane review finding automated reminders cut no-shows by about half, with 24 to 48 hours before the appointment working best.

## Triggers

- Appointment created or changed
- Scheduled sweep each morning

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Appointment created or changed
2. `act` Send the confirmation
3. `wait` Until 48 hours before
4. `act` Reminder with confirm, reschedule and cancel links
5. `branch` Not confirmed 24 hours before: owner task to call
6. `branch` Cancelled: release the slot and offer it to the waitlist
7. `wait` Until the tech is on the way
8. `act` Send the ETA text
9. `enrich` AI reads free-text replies (“can you come after 3?”) and proposes a new slot

## Data

- `Bookings`
- `Waitlist`

## Integrations

- SMS
- Email
- Calendar
- Field service app

## AI steps

- Understand free-text replies and propose a reschedule

Meta models: `muse-spark`

## Human gates

- Owner approves reschedules the AI proposes

## KPIs

- No-show rate
- Share confirmed 24 hours before

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule(daily) -> table.query(Bookings due in 48h) -> ai.write(reminder) -> gmail.draftReply
```

The MVP can run a daily scheduled sweep that drafts reminder emails. Per-appointment timers need a durable wait step.

Steps to add to the catalog: `sms.send`, `wait.until`, `trigger.recordChange`.

## Failure modes

- Reminder for a cancelled appointment: re-read the booking status before every send
- Reminders at 3 am: respect quiet hours
- Customer replies to a reminder and nobody sees it: route replies to playbook 15

## Related

- [[03-online-booking-intake]]
- [[05-dispatch-assignment]]
- [[15-inbox-message-triage]]
