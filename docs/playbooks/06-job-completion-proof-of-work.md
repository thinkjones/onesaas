---
id: pb-06
title: "Job completion and proof of work"
slug: job-completion-proof-of-work
type: playbook
stage: do
priority: P2
status: draft
owner_ask: "When the job's done, write it up, show the photos and get the invoice out."
verticals: ["plumber", "appliance-repair", "cleaning", "landscaping"]
triggers: ["Tech marks the job done"]
tables: ["Jobs", "JobPhotos", "PartsUsed"]
integrations: ["Field service mobile app", "Cloud storage"]
meta_models: ["muse-spark", "muse-voice-transcribe", "sam-3.1"]
human_gates: ["Tech confirms the summary before it goes to the customer"]
kpis: ["Jobs closed the same day", "Callback (rework) rate"]
mvp_coverage: partial
missing_steps: ["signature.capture", "transcribe.audio"]
related: ["[[05-dispatch-assignment]]", "[[08-parts-stock-reorder]]", "[[10-invoice-payment-collection]]"]
tags: ["playbook", "stage/do", "p2"]
created: 2026-10-28
updated: 2026-10-28
---

# 06. Job completion and proof of work

> **Dad's ask:** “When the job's done, write it up, show the photos and get the invoice out.”

Stage: **Do the job** · Priority: **P2** · MVP coverage: **partial**

## Why it matters

Proof of work prevents disputes and feeds the invoice. Writing it up at the end of a long day is the step most likely to be skipped.

## Triggers

- Tech marks the job done

## Steps

Each step is tagged with its engine node type: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate` (human approval), `parallel` or `subflow`.

1. `trigger` Job marked done
2. `branch` Checklist complete? If not, prompt the tech
3. `parallel` Upload before and after photos, record parts used, capture the customer signature
4. `enrich` AI writes the job summary from notes, voice memo and photos
5. `branch` Follow-up needed: create a return visit and a parts order (playbook 08)
6. `act` Send the summary to the customer
7. `subflow` Start the invoice (playbook 10)

## Data

- `Jobs`
- `JobPhotos`
- `PartsUsed`

## Integrations

- Field service mobile app
- Cloud storage

## AI steps

- Summarise notes, voice memo and photos
- Flag missing checklist items
- Transcribe the voice memo

Meta models: `muse-spark`, `muse-voice-transcribe`, `sam-3.1`

## Human gates

- Tech confirms the summary before it goes to the customer

## KPIs

- Jobs closed the same day
- Callback (rework) rate

## Engine mapping

Closest chain using the MVP step catalog in [[2026-10-28-dads-ai-agent-design]] section 5:

```text
trigger.upload(photos, memo) -> ai.extract(parts, work done) -> ai.write(summary) -> table.upsert(Jobs) -> approval.ask -> gmail.draftReply
```

The MVP can take uploaded photos, write the summary and draft the customer email.

Steps to add to the catalog: `signature.capture`, `transcribe.audio`.

## Failure modes

- Photos with customers' faces or house numbers: blur before sharing beyond the customer
- Parts recorded wrong, so the invoice is wrong: show parts on the summary the tech confirms

## Related

- [[05-dispatch-assignment]]
- [[08-parts-stock-reorder]]
- [[10-invoice-payment-collection]]
