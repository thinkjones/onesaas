---
title: "SOHO Workflow Playbooks"
type: index
status: draft
tags: ["playbook", "index"]
created: 2026-10-28
updated: 2026-10-28
---

# SOHO Workflow Playbooks

Twenty playbooks cover the digital back office of most small businesses with 1 to 10 staff (up to 20). Each one is a chore reducer Dad could ask for in plain words, written so the builder agent can turn it into a workflow from the step catalog in [[2026-10-28-dads-ai-agent-design]].

The playbooks follow one customer through five stages: win the job, do the job, get paid, keep the customer, and run the shop. Repeat and referred customers loop back to the start.

## Index

| # | Playbook | Stage | Priority | MVP coverage | Best-fit verticals |
| --- | --- | --- | --- | --- | --- |
| 01 | [[01-missed-call-text-back\|Missed-call text-back and lead capture]] | Win the job | P1 | partial | plumber, appliance-repair, taxi, florist |
| 02 | [[02-quote-approval-follow-up\|Quote, approval and follow-up]] | Win the job | P1 | partial | plumber, appliance-repair, landscaping, events |
| 03 | [[03-online-booking-intake\|Online booking and intake]] | Win the job | P1 | full | salon, cleaning, appliance-repair, taxi |
| 04 | [[04-confirmations-reminders\|Confirmations and reminders]] | Win the job | P1 | partial | salon, cleaning, plumber, appliance-repair |
| 05 | [[05-dispatch-assignment\|Dispatch and assignment]] | Do the job | P1 | none | taxi, plumber, appliance-repair, florist |
| 06 | [[06-job-completion-proof-of-work\|Job completion and proof of work]] | Do the job | P2 | partial | plumber, appliance-repair, cleaning, landscaping |
| 07 | [[07-order-intake-fulfilment\|Order intake and fulfilment]] | Do the job | P1 | partial | florist, bakery, print-shop, retail |
| 08 | [[08-parts-stock-reorder\|Parts and stock reorder]] | Do the job | P2 | partial | appliance-repair, florist, auto, plumber |
| 09 | [[09-supplier-po-warranty-claims\|Supplier PO and warranty claims]] | Do the job | P3 | partial | appliance-repair, hvac, auto |
| 10 | [[10-invoice-payment-collection\|Invoice and payment collection]] | Get paid | P1 | partial | all |
| 11 | [[11-overdue-dunning\|Overdue dunning]] | Get paid | P1 | partial | all |
| 12 | [[12-expense-receipt-capture\|Expense and receipt capture to books]] | Get paid | P2 | full | all |
| 13 | [[13-timesheets-to-payroll\|Timesheets to payroll]] | Get paid | P2 | partial | taxi, cleaning, plumber, salon |
| 14 | [[14-review-request-response\|Review request and response]] | Keep the customer | P1 | partial | all |
| 15 | [[15-inbox-message-triage\|Inbox and message triage]] | Keep the customer | P2 | full | all |
| 16 | [[16-recurring-service-renewals\|Recurring service and renewals]] | Keep the customer | P2 | partial | hvac, pest, pool, cleaning |
| 17 | [[17-seasonal-campaigns-win-back\|Seasonal campaigns and win-back]] | Keep the customer | P3 | full | florist, plumber, hvac, salon |
| 18 | [[18-staff-onboarding-offboarding\|Staff onboarding and offboarding]] | Run the shop | P3 | partial | all businesses with staff |
| 19 | [[19-licence-insurance-vehicle-compliance\|Licence, insurance and vehicle compliance]] | Run the shop | P2 | full | taxi, plumber, hvac, electrician |
| 20 | [[20-owner-digest\|Daily and weekly owner digest]] | Run the shop | P2 | full | all |

Priority is a judgment from revenue impact and breadth, not a measured ranking. MVP coverage: **full** runs with today's catalog, **partial** runs a reduced version (usually Gmail instead of phone or SMS), **none** needs new steps.

## Hackathon demo picks

- **Flow 1** = [[15-inbox-message-triage]] (email to customer record to reply, Glimmer triage)
- **Flow 2** = [[03-online-booking-intake]] (booking request to calendar)
- **Flow 4** = [[17-seasonal-campaigns-win-back]] (photo to SAM cutout to Muse Image to Meta post draft)
- Easy extras with full coverage: [[12-expense-receipt-capture]], [[19-licence-insurance-vehicle-compliance]], [[20-owner-digest]]

## Vertical packs

A pack is the same library with a different starter set, default timings and message templates.

| Vertical | Starter playbooks | Vertical-specific twist |
| --- | --- | --- |
| Taxi / private hire | 01, 03, 04, 05, 10, 13, 19 | Seconds-level dispatch with accept timeout; airport flight-delay watch; corporate account billing; expired permits block dispatch |
| Plumber | 01, 02, 04, 05, 06, 10, 14 | Emergency triage pages on-call; photo-based quoting; gas and backflow certificate tracking |
| Appliance repair | 01, 03, 05, 06, 08, 09, 10 | Make, model and serial read from a label photo; parts-wait rebooking; manufacturer warranty claims |
| Florist | 07, 05, 10, 14, 15, 17, 08 | Buyer vs recipient; card message; wire-order intake; per-date capacity caps; delivered photo to buyer |
| Cleaning | 03, 04, 05, 06, 10, 16, 14 | Recurring visits by default; per-room photo checklist; key and alarm code handling |
| Salon / barber | 03, 04, 10, 14, 16, 17 | Deposits and no-show fees; rebook at checkout; waitlist fill on cancel |
| Landscaping / pest / pool | 02, 05, 16, 10, 11, 17 | Route-dense recurring visits; weather reschedule; seasonal renewal |
| Bakery / print shop | 07, 08, 10, 15, 17 | Production calendar by pickup time; design approval before production |

## File format

Every playbook has YAML frontmatter (`id`, `stage`, `priority`, `verticals`, `triggers`, `tables`, `integrations`, `meta_models`, `human_gates`, `kpis`, `mvp_coverage`, `missing_steps`, `related`) and the same sections: Dad's ask, Why it matters, Triggers, Steps, Data, Integrations, AI steps, Human gates, KPIs, Engine mapping, Failure modes, Related. Steps are tagged with node types so they can be parsed into a DAG.

## Steps the catalog is missing

Most gaps are phone, SMS, payments and durable waits: `sms.send`, `trigger.missedCall`, `trigger.webhook`, `trigger.recordChange`, `wait.until`, `payment.link`, `payment.charge`, `accounting.sync`, `review.fetch`, `review.reply`. These are post-hackathon work; see each playbook's `missing_steps`.

## Sources

- [Jobber: best field service management software 2026](https://www.getjobber.com/academy/best-field-service-management-software/)
- [Jobber Help Center: quote and invoice follow-ups](https://help.getjobber.com/hc/en-us/articles/24244124296471)
- [Guideflow: best taxi dispatch software 2026](https://www.guideflow.com/blog/taxi-dispatch-software)
- [PulseRevOps: florist software stack](https://pulserevops.com/tech-stacks/tk341)
- [AIRA: missed call text back](https://getaira.io/blog/missed-call-text-back)
- [SchedulingKit: appointment no-show statistics](https://schedulingkit.com/hub/scheduling/appointment-no-show-statistics)
- [Xero: late payments in 2026](https://www.xero.com/us/guides/late-payment-small-business/)
- [Beancount: 2026 collections playbook](https://beancount.io/blog/2026/07/16/b2b-late-payment-crisis-2026-collections-playbook-guide)
- [Rework: best accounting software 2026 (Intuit late-payments figures)](https://resources.rework.com/tools/erp-finance/best-accounting-software-2026)
- [BrightLocal: consumer review survey](https://www.brightlocal.com/research/consumer-review-survey/)

Statistics from vendor blogs are directional; check the primary report before quoting them in the demo video.
