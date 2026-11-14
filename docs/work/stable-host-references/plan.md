---
description: plan for proposal 15, stable host references (identity caches on both encoding stages, one write path through json.encode) — process, the one phase and its acceptance criteria; read before forking or examining it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [plan, runtime, boundary, json, identity]
---

# Plan: stable host references

Design: `docs/proposals/15-stable-host-references.md` (mechanism, soundness rules, rejected
alternatives).

## Process

One phase, one implementer fork, two commits: structural first (every boundary write through
`json.encode`, behavior unchanged), then the caches. A cold reviewer and QA examine the whole diff,
so no separate merge review. One phase because the structural step is a few dozen lines whose only
test is the existing suite; a branch for it costs more than it isolates. Review is not trimmed: the
caches sit on the in-place writer's soundness.

## H1: stable host references

**Commit 1 (refactor):** `codecCall`'s write direction closes `json.encode<T>`; the std `Array`,
`Map` and `T?` codecs and `stringify` call `encode`. Behavior unchanged; only tests naming the
encoder or its trace frames change.

**Commit 2 (feat):** the identity module, the two natives behind `encode`'s body, `plainOfJson`
frozen and cached, forgetting on every in-place change path, the mock bypass. Spec §9, boundary.md,
definition.md, FormBuilder design §3/§8, `docs/reuse/` lines.

Acceptance criteria (host = `ista run --host` module or the host API):
- A value kept and passed again to an extern gives the host the identical (`===`) object, at the
  top and at every depth; a finished instance's outcome read twice is the identical object.
- An element kept in an array or map that changed (pushed, set, spliced, rebuilt around it) is the
  identical object; the changed container is a new one.
- A value rebuilt equal is a new object; a value changed in place is a new object, and so is every
  ancestor on its path, while untouched siblings stay identical.
- One runtime object passed as two types whose codecs differ (a layout-keeping conversion, such as
  `Box<"a">` to `Box<String>`, alone and inside tuples) gets each codec's JSON.
- A kept `Array<Json>` or `Map<String, Json>` passed as `Json` twice is the identical object.
- A codec reading a `context` constant gives each instance its own value's JSON.
- Disposable host types (and arrays and optionals of them) still cross as before.
- Everything a host gets is deeply frozen.
- A cached `Json` held by the program and changed by it (through `json.encode` and a match on its
  parts) never changes what the cache gives for the original value.
- The lifetimes oracle and value-semantics properties hold with values crossing to a host between
  writes.
- `Json` is refused exactly when the uncached walk refuses it (empty arrays and maps at the limit
  included), whether or not its parts were cached.
- Under a mock held by the instance or relayed from an ancestor, every encoding calls the mock (the
  testing suite's outcome-encoder mock test included); after it is released, caching resumes.
- Every in-place change path (maps' set and delete included) forgets the changed nodes' entries.
- An array pushed after every send stays linear (no copy per send).
- `npm run verify` green.
