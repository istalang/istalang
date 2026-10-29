---
description: plan for M6 (formatter) and M7 (language service, LSP, VS Code client), built in parallel — read before forking, implementing or examining any M6/M7 phase
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [plan, m6, m7, formatter, lsp]
---

# M6 + M7 — Formatter and language service

Details: `formatter.md` (M6), `language-service.md` (M7). Human decisions of 2026-10-29: Q3 keeps the side tables, made total by type; P5 is built in M7; canonical format at width 100; Prettier's doc printer.

**Process:** the work runs as parallel partitions, each in a worktree; a phase starts as soon as its dependencies merge. *Why:* M6 and M7 share no files except one seam, M7's formatting provider calling `formatTree`, and M7's infrastructure splits cleanly by layer.
- **Reviews.** One pi root reviewer reads every `docs/reuse` file and the code the plan touches. It reviews this plan first. After that, each phase forks it to review that phase's diff, and a last fork does the merge review.
- **QA.** Every phase that changes behaviour gets a cold `qa`.
- **Design gate.** P5's mechanism is not designed yet. Its first phase writes the design, and the human approves that design before any P5 code.

| Phase | Scope | Needs | qa |
| --- | --- | --- | --- |
| **6** Formatter | `ista fmt`, the formatting API, `formatTree` | — | yes |
| **7B** Service infrastructure | syntax position queries, binder uses and visible names, Q14, project loading outside `cli/` | — | no¹ |
| **7A.1** Checker surface | Q3 (typed tables complete by type), what each identifier denotes, the body holding a node, the service queries, per-module diagnostics | — | no¹ |
| **7A.2** P5 design | `incremental-checking.md`: mechanism, phases, budget; human approval | 7A.1 | — |
| **7A.3–7A.7** P5 build | `incremental-checking.md`, Phases, in order 7A.3 → 7A.7 | 7A.2; 7A.5 also 7.2a and 7.2b | per phase |
| **7.1** Server | `language-service/`, `lsp/`, `ista lsp`; diagnostics, symbols, folding, semantic tokens, formatting | 7B (and 6 for formatting) | yes |
| **7.2a** Navigation | definition, references, rename | 7.1, 7A.1 | yes |
| **7.2b** Types | hover, inlay hints, signature help, completion | 7.1, 7A.1 | yes |
| **7.3** VS Code client | the extension starts `ista lsp` | 7.1 | no² |

¹ These add queries without changing any behaviour. Their own property tests cover them, and so does the qa of 7.2a and 7.2b, which call them.
² The human checks it by installing the extension. A unit test covers how the client is configured.

**Order:** the tech-lead first commits the layers (`language-service.md`, Phases), so no two branches edit one rule. Then 6, 7B and 7A.1. Next 7A.2 and 7.1, each as soon as its dependency merges. Last, 7.2a, 7.2b, 7.3 and P5's build, each as soon as its dependencies merge.

**Contracts:**
- The Checker's public surface is additive only after 7A.1, so P5 never blocks a provider.
- The syntax contract changes twice, in 7A.5 (`FunctionDeclaration` loses `body`) and 7A.6 (spans anchored to segments). Each migrates every caller and runs with no other branch open on syntax consumers (human, with the P5 design).
- Each shared surface has one owner: `formatTree` (6), syntax and binder queries (7B), checker queries (7A.1), `ista/source` (7.1).
- 6 imports source discovery from `cli/project.ts`, which 7B moves; the later merge updates the import.
- The owner writes each contract into `architecture.md` when its phase merges.

**End:** after the last merge, an e2e `qa` over the LSP and `ista fmt`, then a merge review of `main` since this plan's commit.

**Out of scope:** code actions, range formatting, workspace symbols, call hierarchy, diagnostics of unopened files beyond `ista check`'s, and packages (M8).
