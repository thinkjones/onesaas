---
id: pb-20
title: "Daily and weekly owner digest"
slug: owner-digest
type: playbook
stage: run
priority: P2
status: draft
owner_ask: "Every morning, tell me what happened yesterday and what needs me today."
verticals: ["all"]
triggers: ["Schedule: 6:30 am daily, Monday 7 am weekly"]
tables: ["read-only: all"]
integrations: ["Field service app", "Accounting", "Phone", "Reviews"]
meta_models: ["muse-spark"]
human_gates: []
kpis: ["Digest open rate", "Actions taken from the digest"]
mvp_coverage: full
missing_steps: []
related: ["[[11-overdue-dunning]]", "[[15-inbox-message-triage]]", "[[19-licence-insurance-vehicle-compliance]]"]
tags: ["playbook", "stage/run", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 20. Daily and weekly owner digest

> **Dad's ask:** “Every morning, tell me what happened yesterday and what needs me today.”

Stage: **Run the shop** · Priority: **P2** · MVP coverage: **full**

## Why it matters

The owner has no time to open five apps. One short message with links into each item is the habit that makes the rest of the system visible.

## Triggers

- Schedule: 6:30 am daily, Monday 7 am weekly

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Scheduled time
2. `parallel` Pull jobs, revenue, cash collected, overdue invoices, new leads, reviews and no-shows
3. `fetch` Pull today's schedule and gaps
4. `enrich` AI writes the summary with three suggested actions and any anomalies
5. `act` Send by email or text with links into each item

## Data

- `read-only: all`

## Integrations

- Field service app
- Accounting
- Phone
- Reviews

## AI steps

- Summarise and spot anomalies (“no-shows doubled on Tuesday”)

Meta models: `muse-spark`

## Human gates

- None. The run is read-only or informational.

## KPIs

- Digest open rate
- Actions taken from the digest

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.schedule(daily) -> table.query(*) -> code.transform(metrics) -> ai.write(digest) -> notify
```

Runs in the MVP over the app's own tables.

## Failure modes

- A long digest nobody reads: cap at three actions and five numbers
- Numbers that disagree with the source app: link every number to its records

## Related

- [[11-overdue-dunning]]
- [[15-inbox-message-triage]]
- [[19-licence-insurance-vehicle-compliance]]
