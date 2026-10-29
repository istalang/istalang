---
description: plan for making editor completion meet the approved scenario catalogue — read before forking, implementing or examining any completion phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [plan, completion, lsp]
---

# Completion — meeting the catalogue

Spec: `scenarios.md` and the files beside it (human-approved 2026-10-30, with its five decisions beyond the language spec). Acceptance: the scenario tests `src/lsp/providers/completion-scenarios-*.test.ts`, one per id, the unmet ones pinned with `it.fails`. A phase is done when every scenario it owns passes and its `fails: true` is dropped.

**Process:** one structural phase, then seven parallel partitions, each in a worktree. *Why:* today one function answers every position, so every gap edits it; once places and item shape are a contract with one provider per place, the gaps split by place with little shared code.
- **Reviews.** Each phase forks the root reviewer (`rvroot-gamu`); a last fork does the merge review of `main` since this plan's commit.
- **QA.** No per-phase qa: the acceptance tests were written cold, from the catalogue, before any fix. At the end the catalogue's author (`cmp-lepi`) re-probes every scenario through the built server and refreshes the statuses in the catalogue; partitions don't edit the catalogue's statuses.

| Phase | Scope | Scenarios | Needs |
| --- | --- | --- | --- |
| **C1** Places and items | the place a cursor is in, as a closed union decided once (grammar position, member, literal field, call argument, pattern, import, annotation, type, declared name, nothing); one provider per place in a typed table, each answering today's list; the item model `mechanics.md` requires (insert text or snippet, re-trigger, rank, preselect, kind, detail) mapped to LSP once | none flipped; classification unit-tested against the catalogue's positions | — |
| **C2a** Keywords and names by position | what each grammar position admits | TL, DH, TY, SD, ST, EX, CO, CF, NO (not NO-08/09) | C1 |
| **C2b** Items and ranking | `name: ` with re-trigger, ranking buckets, expected type first and preselected, bare variants only where an enum is expected, kinds, details, `(` after methods | OR, ET, LI | C1 |
| **C2c** Triggers and client | declared triggers (space, `@`, quotes, `/`), answers decided by place, client defaults | TR, NO-08, NO-09, VC | C1 |
| **C2d** Patterns | `case` starts, pattern fields, `as`/`is` | PA | C1 |
| **C2e** Calls | argument names, the call's `,` | CA | C1 |
| **C2f** Imports and annotations | exports, specifiers, annotation names and fields | IM, AN | C1 |
| **C2g** Members, scope, resilience | ME, scope bugs (SC-07), broken and unfinished text | ME, SC, RB | C1 |

**Contracts:** C1 owns the place union, the provider table and the item model, and writes them into `architecture.md`. After C1 the item model is additive only. Each partition owns its places' provider files; a place a partition needs that C1 lacks is an amendment, sent to the tech-lead. Checker queries a partition adds are additive, in files of their own.

**End:** `cmp-lepi` re-probes and refreshes the catalogue; a merge review; F12 and F13 close with PA and VC.

**Out of scope:** std-module documents, multi-root workspaces, `*.test.ista` imports (the catalogue's "Not probed").
