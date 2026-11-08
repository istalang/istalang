---
description: sub-plan for redesigning I2's joint solving around one constraint scope (i2-scope.md) — process, two phases with falsifiable acceptance, verification; read before forking or examining an I2 redesign phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-08
tags: [plan, checker, inference, i2]
---

# I2 redesign — plan

Contract: `i2-scope.md`. Base: `vi-i2` at `cf31c2d8` (I2's first build: literal building and
`known-parameters.ts` deleted, variants as generic calls, joining via `joint.ts`).

## Process

**Two sequential phases on `vi-i2` in this worktree, each an implementer fork with review (`kinu`)
and qa (`lose`), human approval before reporting.** *Why:* the scope is a structural swap (J1)
that J2's coverage stands on. Both touch the same files, so they can't run side by side. The
sub-lead reports to the root tech-lead once J2 lands, and doesn't merge.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **J1** Scope (structural) | `i2-scope.md` §1, §4–§7 for what joins today (calls, `T{…}`, `new T{…}`, non-empty array and map literals). Deletes `joint.ts`, `checkJoining`, `mayJoin`, the `joining` closures, `Inference.within` and twin translation. Postponement keeps `Accepts`, judged from the scope's loop. Docs: `architecture.md` (the scope seam), `docs/reuse/`, design §4 "As built" | The suite stays as on `cf31c2d8`. These now check: `foo(id(1))` reports `Expected String, found Int`; `fn invokeOne<...A, R>(f: fn(Int, ...A) -> R, ...rest: A) -> R: f(id(1), ...rest)`; `foo(Pair{a: 1})` still reports the missing field; `outer(empty(), 1)`, `takeResults(Result.Ok(1), Result.Err("no"))`. A property: no recorded type or diagnostic over the check corpus mentions a variable. Profile within noise |
| **J2** One model (behavioural) | `i2-scope.md` §2–§3: every joining kind joins; postponed members as placeholders replace `Accepts` and both judging loops; a lambda's tail and returns join while its result is open; agreeing parts settle a result variable; struct literals expect; fresh literals recorded at settle. Deletes the rest of §8 | `joint.test.ts` green (the four failing cases from `cf31c2d8` included): `lose`'s six violations and `kinu`'s correctness 2–4. I2's acceptance rows in `plan.md`. B38 and B39's examples re-checked, and their rows closed if they pass. `variants.test.ts`, `recursive-uses.test.ts`, `literal-arguments.test.ts` unchanged. No `Accepts` remains. Profile within noise |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| J1 | yes (`lose`) | yes (`kinu`) | Exit paths of every construct; records and diagnostics free of variables |
| J2 | yes (`lose`) | yes (`kinu`) | The joining-kind table, postponed members across composites and lambdas |
