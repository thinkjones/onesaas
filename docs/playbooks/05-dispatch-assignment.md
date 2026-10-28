---
id: pb-05
title: "Dispatch and assignment"
slug: dispatch-assignment
type: playbook
stage: do
priority: P1
status: draft
owner_ask: "Send the right person to the job and tell the customer when they'll arrive."
verticals: ["taxi", "plumber", "appliance-repair", "florist", "cleaning", "courier"]
triggers: ["Job created", "Ride booked", "Delivery due"]
tables: ["Jobs", "Staff", "Vehicles", "StatusEvents"]
integrations: ["Maps and routing (Google Maps, Routific, Onfleet)", "Driver or tech app", "Dispatch system (TaxiCaller, Autocab) or field service app"]
meta_models: ["muse-spark"]
human_gates: ["Dispatcher picks when no candidate clears the threshold"]
kpis: ["Time to assign", "On-time arrival", "Jobs per tech or trips per driver per day"]
mvp_coverage: none
missing_steps: ["dispatch.assign", "maps.eta", "sms.send", "trigger.recordChange"]
related: ["[[03-online-booking-intake]]", "[[06-job-completion-proof-of-work]]", "[[07-order-intake-fulfilment]]", "[[19-licence-insurance-vehicle-compliance]]"]
tags: ["playbook", "stage/do", "p1"]
created: 2026-10-28
updated: 2026-10-28
---

# 05. Dispatch and assignment

> **Dad's ask:** “Send the right person to the job and tell the customer when they'll arrive.”

Stage: **Do the job** · Priority: **P1** · MVP coverage: **none**

## Why it matters

Dispatch decides how many jobs or trips fit in a day. Taxi needs seconds-level assignment; trades need the right skills and parts on the van. Build it as one step with a pluggable assignment policy.

## Triggers

- Job created
- Ride booked
- Delivery due

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` New job, trip or delivery
2. `fetch` Load candidates with location, skills, availability, rating and vehicle
3. `enrich` Score candidates against the assignment policy
4. `branch` Score above threshold: auto-assign. Otherwise the dispatcher picks
5. `act` Push the job to the driver or tech app
6. `wait` Accept window (about 60 s for taxi, 15 min for trades)
7. `branch` Declined or timed out: next candidate
8. `act` Send the customer an ETA with a tracking link
9. `store` Record status: en route, arrived, done

## Data

- `Jobs`
- `Staff`
- `Vehicles`
- `StatusEvents`

## Integrations

- Maps and routing (Google Maps, Routific, Onfleet)
- Driver or tech app
- Dispatch system (TaxiCaller, Autocab) or field service app

## AI steps

- Rebalance the day when a job overruns
- Draft delay messages to affected customers

Meta models: `muse-spark`

## Human gates

- Dispatcher picks when no candidate clears the threshold

## KPIs

- Time to assign
- On-time arrival
- Jobs per tech or trips per driver per day

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
(not in MVP) trigger.recordChange(Jobs) -> table.query(Staff) -> code.transform(score) -> approval.ask -> notify
```

Out of scope for the hackathon. A simple version can score staff with code.transform and ask the owner to approve the pick.

Steps to add to the catalog: `dispatch.assign`, `maps.eta`, `sms.send`, `trigger.recordChange`.

## Failure modes

- Assigning staff whose licence or permit has expired: check playbook 19 before assigning
- GPS stale or missing: fall back to the last known job location
- Accept loop that never ends: cap the number of candidates, then alert the owner

## Related

- [[03-online-booking-intake]]
- [[06-job-completion-proof-of-work]]
- [[07-order-intake-fulfilment]]
- [[19-licence-insurance-vehicle-compliance]]
