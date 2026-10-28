# CLAUDE.md: playbooks

This folder holds the SOHO workflow playbook library for My Dad's AI Agent (Meta AI Hackathon, Oct 27 to Nov 4, 2026). Read [[README]] first for the index and the design spec at `../plans/2026-10-28-dads-ai-agent-design.md` for the step catalog.

## What a playbook is

One file per workflow a small-business owner might ask for, named `NN-slug.md`. A playbook is product research and a template spec, not code. The builder agent and the template gallery should be able to read one and produce a workflow definition.

## Rules when editing or adding playbooks

- Keep the frontmatter keys and order used in the existing files. `id` is `pb-NN`, `type` is `playbook`, `stage` is one of `win`, `do`, `paid`, `keep`, `run`, `priority` is `P1` to `P3`, `mvp_coverage` is `full`, `partial` or `none`.
- Keep the section order: Dad's ask, Why it matters, Triggers, Steps, Data, Integrations, AI steps, Human gates, KPIs, Engine mapping, Failure modes, Related.
- Tag every step with a node type in backticks: `trigger`, `fetch`, `enrich`, `store`, `act`, `branch`, `wait`, `gate`, `parallel`, `subflow`. These map to the engine's catalog groups (Trigger, Fetch, Enrich, Store, Act) plus control flow.
- The Engine mapping block uses only step types that exist in the MVP catalog (`trigger.*`, `gmail.*`, `calendar.*`, `table.*`, `ai.*`, `image.*`, `code.transform`, `meta.draftPost`, `approval.ask`, `notify`). Anything else goes in `missing_steps`.
- Nothing sends automatically in the MVP: every outbound message ends in `approval.ask` then a draft step.
- Write Dad's ask in his words: short, plain, no jargon.
- Never hard-wrap prose. Each paragraph stays on one line.
- Use Obsidian wikilinks (`[[NN-slug]]`) for cross-references and update `related` in both files.
- Cite statistics with a link in the README Sources list and call vendor figures directional.
- When you add a playbook, add its row to the README index and to any vertical pack it belongs to.

## Good next tasks

- Turn the Engine mapping of each `full` playbook into a JSON workflow fixture for builder evals.
- Add a `templates/` folder with message templates per playbook and vertical.
- Add `missing_steps` to the post-hackathon catalog backlog.
