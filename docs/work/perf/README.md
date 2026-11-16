---
description: how to profile the toolchain — which script under scripts/profile/ answers which question (cold compile phases, whole-check hot spots, exact call counts, allocations, toolchain-wide shares) and how to trace a cost to its caller; read before any performance work or before writing a new profiling harness
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-17
last_updated: 2026-11-17
tags: [performance, profiling, tooling]
---

# Profiling the toolchain

The tools are in `scripts/profile/`; each file's banner gives its usage. They all profile the built `dist`, so the scripts that measure (`profile*` except `profile:analyze` and `profile:allocations`) build first.

| Question | Run |
|---|---|
| How long does a cold build take, phase by phase (load, bind, check, lower, write, then deploy and start, or run the tests)? | `npm run profile:cold -- <dir> [runs] [minimal\|fb\|std-tests]`: one fresh process per run, no cache |
| Where does the test suite's CPU go, by file and phase? | `npm run profile:suite -- [vitest options]`: a profile per test file in `.vitest/profiles/`, read with `profile:analyze -- .vitest/profiles '*'` |
| Where does a whole check spend its time, on which inputs? | `npm run profile:check -- <dir> cpu [workload…]` (form builder cold and warm, std tests, every std module, decimal tests ×16, corpus) |
| How many times is a function really called? | the same with `count`: exact counts from V8's precise coverage, joined into `profile:analyze`'s report |
| What is the GC's share spent on? | the same with `alloc`, then `npm run profile:allocations -- <dir> <workload>` |
| Shares across the whole toolchain (LSP queries, formatter, incremental edit, scaling)? | `npm run profile -- <dir>` (`toolchain.ts`) |
| What is hot, who calls it, and what is it made of? | `npm run profile:analyze -- <dir> <name\|glob>`, with `--subsystem`, `--within`, `--callers`, `--children` and `--stacks` |

## Reading a profile

- **Merge the cold runs.** One cold run is a few thousand samples; `profile:analyze` merges a glob (`'cold-fb-*'`).
- **Trace a cost through `--subsystem name=fileA,fileB`.** It gives the files' inclusive and self share, and where the group is entered from, with memo and entry-table frames skipped. The entry point is usually the decision to change; the hot leaf rarely is.
- **Compare shares, not wall time.** Other agents load the machine. Counting (`count`) slows every call, so compare times only between runs of the same mode.
- **A lookup at a few hundred thousand calls per check is a fix to make, not noise.** `memo`'s own frame is about 10% of a check, so before memoizing more, check its counts.

## Reports

- `profile-2026-11-06.md`: the whole toolchain at `189782f6` (tracker P22–P31).
- `full-check-2026-11-06.md`: the cold end-to-end compile at `f999c924`, after P22–P24 (tracker P22, P25, P32–P37).
