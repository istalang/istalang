---
description: async-kinds merge review — every finding over db0b1ac3..main, triaged into the fix steps that close them; read before forking or examining a merge-review fix
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-11
last_updated: 2026-11-11
tags: [proposal-8, review]
---

# Async kinds: merge review

Four cold reviews by area (checker `muke`, lowering and editor `loba`, runtime `neme`, stdlib and
docs `mivo`). Every finding is fixed in this feature; none goes to the tracker. A step's acceptance:
each finding it owns is gone, with a test that failed before its fix where it is a defect.

| Step | Owns | Waits on |
|---|---|---|
| **M1** Runtime structure | Dead interims: R2's instance disposal-notice queue and `NativeFutures.onDisposed`; host-fill leftovers (`settle`, `Arrived`, `arrival` replay, the `panicked` refusal), so the format sweep checks every instance's ending again; the six runtime files over 400 lines; stale runtime and CLI comments | — |
| **M2** Slots and futures | `all`/`any`/`quorum`/`allSettled` watched from the call on (no pass-over between turns); `Inbox` after a lost `select`; `FakeClock` resolving timers due together | — |
| **M3** Checker soundness | Variance over a function type's mark and send; default-typed fields' kinds; a requirement call's substitution in the data rule; `live` suites refused, and the Definition refusing `live` test entries and an ill-typed `jobServer`; deferred calls' sendability over the fitted argument | — |
| **M4** Runtime lifecycle | Snapshot check (defaults, `invocation` replay, runs, callbacks); a finished segment's roots and executions before its constants; the live run's resume loop, `runReady` after `wakeDue`, panics on finishing; `Contexts` dropping released calls and serving a retried context again; `LiveResolver` misuse through `fail`; losers registered beside `disposing()`, a panic inside collection; the test context finishing | M1 |
| **M5** Editor, parser, lowering | Completion of marked lambdas and types, the top-level words, the function-value fit, surroundings; `parseModified`'s head dispatch; `isTakerShaped`; B79's body reuse; K1b relics in lowering; `jobDeclarationsOf`; the rewrite passes' `runtime` import; the duplicated test kits; `member.test.ts`'s corpus probe failing (5101) at a generic requirement (rati) | — |
| **M6** Docs | Spec, `architecture.md`, `boundary.md`, `definition.md`, `docs/reuse/`, `guide.md` against the code after M1–M5 | M1–M5 |

At most three run at once: M1–M3 first, M4 and M5 as slots free, M6 last. Reports, with locations
and scenarios: `/private/tmp/claude-501/-Users-arash-Projects-istalang/843de810-e581-4b81-b24d-dfde52274fc7/scratchpad/mr-{muke,loba,neme,mivo}.md`.
