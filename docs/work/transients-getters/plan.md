---
description: plan for proposal 13 (transient variables and getters) — process, partitions, phases and acceptance criteria; read before forking or examining any of its phases
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [plan, transient, getters]
---

# Plan: transients and getters

Spec: `docs/proposals/13-transients-and-getters.md`. Contracts: `contracts.md` (same folder).

## Process

Two partitions in parallel worktrees, since they share no code: transients live in lowering and the
runtime, getters in checker resolution and the editor. The getters' structural phase G1 comes
first, so the method/getter split is written once. Every phase gets a cold reviewer; behavioral ones
get QA, since both reach a persisted format or high fan-in resolution. Merge review of the whole
branch at the end.

```
T1 ───────────────┐
G1 ──▶ G2 ────────┴──▶ merge review
```

## Phases

**T1: transient variables (behavioral).** The whole slice: syntax, checker, flow, lowering, the
`transient` instruction, the runtime lookup, spec §3.4 and §7, and `docs/arch/definition.md`.
- `paths` from the proposal runs in linear calls and gives the right counts; a second top-level call
  starts with an empty memo.
- `nested`/`render` share one `depth` across instances of a generic caller, while a generic
  function's own transient is one per instance.
- Any function declares one: unmarked, `live` or `ista`, async or not.
- An async call (ista or live) nested in the outermost call shares it, also once the outermost
  call has returned; the next outermost call starts fresh; a spawned instance starts fresh.
- A closure capturing it, and `&` passing it, change the one shared value.
- An ista function keeps it across an `await` and a snapshot restore.
- Compile errors: a transient not at the top of a body, `transient const`, an initializer reading a
  parameter or local.
- Its value is released when the last call sharing it ends, and disposables in it are disposed
  then.

**G1: one enumeration of a type's members (structural).** `lookup/members.ts` gets methods and
statics from `candidates.ts` instead of rebuilding them (`docs/audit/dry-review-2026-11-13.md`,
finding 3). No behavior changes, except that completion now lists trait methods on unions, which
finding 3 names as the drift.
- Completion, hover and lookup tests pass unchanged.
- `members.ts` no longer enumerates candidates itself.
- The known-copy note in `docs/reuse/calls-and-resolution.md` is removed.

**G2: getters (behavioral).** The `Getter` annotation, its declaration checks, member reads, flow,
conflicts, editor features, spec §3.1, §3.16 and §3.18, and `docs/reuse`.
- `ada.full` gives "Ada Lovelace"; `x?.g` in an optional chain; `lease.g` on a shared struct's
  handle; a generic getter; a getter declared in a module importing the type.
- `x.g(…)` calls the function a getter gives; `g(x)` calls the getter itself.
- `==`, JSON, struct patterns, `keyof`, spreads, shapes and struct constraints ignore getters.
- Compile errors: assigning, `&` or a literal field naming a getter; a `@Getter` taking other
  parameters, `&self` or being async; a field and a getter, or a getter and a method, of one name
  used on a type.
- A marked getter obeys the data rule at each read as its call would: unmarked code reading an
  `ista` getter is a compile error.
- Completion lists getters as properties; hover, definition and rename reach the getter.

## Out of scope

Filed in `docs/work/tracker.md`: a declaration-time "one meaning per name" check (F31, today it is
reported where used); getters as trait requirements (F32). FormBuilder's generator cycle check
belongs to the computed feature (`docs/work/computed/design.md`).
