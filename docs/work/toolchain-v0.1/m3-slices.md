---
description: M3 (feature slices) phase details — slice scopes, ownership of shared surfaces, ordering under the 3-parallel cap, corpus format, code ranges and falsifiable acceptance; read before implementing or examining an M3 slice
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-25
last_updated: 2026-10-25
tags: [plan, m3, checker, lowering, runtime]
---

# M3 — Feature slices

## Rules for every slice

- **What a slice is.** A slice moves the checker frontier: its constructs stop reporting 5000 and work end to end through checker, lowering and runtime. It replaces `notSupported`/`notRunYet` entries in the handler tables and never adds a second path beside them.
- **The IR contract.** `docs/arch/definition.md` is the contract. A slice that first emits an instruction kind may amend that kind's load rule, through the tech-lead.
- **Spec gaps.** Each slice's first step is a gap sweep over its sections, presented to the human with proposed defaults before code. Decisions are folded into `docs/spec.md`.
- **Diagnostic codes.** Each slice allocates only inside its own checker range, shown next to its name below.
- **Corpus.** Uses the format and harness that 3.1 lands first.
- **Acceptance**, beyond each slice's own:
  - Every owned surface has at least one valid case and one invalid case in the corpus.
  - The lowering totality property holds: a checker-clean program compiles and loads.
  - Spec fences for the slice's sections check clean, except where they use constructs from slices not yet landed.
- **Parallel slices** (∥) run in worktrees, at most 3 at a time.
  - The handler tables, `diagnostics/code-blocks.ts` and the tracker are shared. The fork that rebases second resolves conflicts in them.
  - The tech-lead runs an e2e `qa` after each ∥ group.

## Corpus format (landed by 3.1)

- `test/corpus/<topic>/…/*.ista`, read recursively by one harness.
- A valid program's header is `# outcome: <json>` or `# panic: <message>`.
- An invalid program's header has one line per expected diagnostic: `# error: <code> at <line>:<col>`. The harness asserts that exactly these diagnostics are reported.

## Shared surfaces and their owners

| Surface | Owner | Consumers |
| --- | --- | --- |
| Generic instantiation, generic overload resolution, ADL, trait conformance (including `Sendable` derivation), operators and `$`/`T(x)` as calls | 3.1 | all |
| Enum declarations and variant construction; `Optional`, `none`, implicit wrap into `T?` | 3.1 | 3.3 (`at`/`get`), 3.4, 3.5 |
| Struct and tuple values, anonymous structs, method receivers (implicit `&self`) over the concrete resolver, `const` and `&` | 3.2 | 3.4 (patterns), 3.5 (capture struct) |
| `Result`, `Error` and its runtime `trace` | 3.4 | 3.9 |
| Holders (by reachability), release points, disposal | 3.7 | 3.6, 3.8, 3.9 (each stubs against definition.md until 3.7 lands) |
| Futures, slots, scheduler wake-up | 3.6 | 3.7, 3.8, 3.9 |
| `extern` declarations (including `extern sendable struct`) | 3.9 | 3.6 (host queues in tests) |

## Order

```
{ 3.1 ∥ 3.2 } ──▶ { 3.3 ∥ 3.4 ∥ 3.5 } ──▶ { D-A ∥ D-B } ──▶ { 3.6 ∥ 3.9 } ──▶ { 3.7 ∥ 3.8 }, 3.9 continuing alongside
```

3.2 runs alongside 3.1 because structs, tuples, `const`, `&` and concrete method receivers need no generics. 3.1 then extends the resolver to generic methods.

## Slices

**3.1 Generics and calls** (codes 5100–5199). Everything listed as 3.1's above, plus type aliases. Also the corpus format and harness, and refusing direct `dispose` calls, which keeps totality while generic calls open (D59's first half). Spec §3.5, §3.7, §3.9, §3.10, §3.11 declarations, §3.17.

*Acceptance:* a valid/invalid pair for each of the following.
- type-argument inference and explicit type arguments
- generic structs
- each §3.7 overload rule: concrete beats generic; ambiguity is an error; defaults and rest; the self value/reference clash
- ADL: struct operators, with `time.delay` rewritten as `at(now() + d)`
- trait constraints and static requirements (`T.zero()`)
- `Sendable` derivation
- conversions, `T(x)` → `T.from`
- aliases
- enum declaration and construction
- `Optional` and implicit wrapping

**3.2 ∥ Values** (5200–5299). Struct literals in every form (positional, shorthand, spread update, `struct{…}`), anonymous structs, tuples and destructuring, methods and static functions, value semantics, deep `const`, `&` references. Spec §3.1, §3.4, §3.7, §3.15. Includes debt D58.

*Acceptance:* value semantics are observable in outcomes: a mutated copy leaves the original unchanged, while a change through `&` reaches the caller.

**3.3 ∥ Collections** (5300–5399). Arrays, maps, ranges, indexing and slicing in both the panicking and the safe form, `IndexAssignable`, map literals for `Default` types, comprehensions, `for` over any `Iterable`. Spec §2, §3.8, §3.9, §3.10, §4.

*Acceptance:*
- An out-of-range `xs[i]` panics; `xs.at(-1)` reads from the end.
- A missing `m[k]` panics; `m.get(k)` returns `none`.
- `a[3..5] = xs` replaces a span, even with a different length.
- `s[i]` counts code points.
- Comprehension filtering and destructuring work.
- `for k, v in m` works.

**3.4 ∥ Patterns** (5400–5499). `match` over every pattern form, with exhaustiveness and guards; `is` with bindings scoped by flow; `?.`, `??`, and `?` on `Result`; must-use and `drop` for `Result`; `Error`; `panic`. Spec §3.11, §3.12, §4.

*Acceptance:*
- An incomplete `match` is an error.
- Guarded cases don't count toward exhaustiveness.
- `?` returns the `Err` early.
- An unused `Result` is an error.
- `panic` freezes the instance with nothing committed.

**3.5 ∥ Closures** (5500–5599). Lambdas (typed and inferred), named lambdas, local functions, captures (a `const` is copied, a `let` is shared through `Shared`), and `Shared`/`$`. Spec §3.8, §3.14.

*Acceptance:* the `makeCounter` example and §3.14's sharing rules hold as outcomes, and capturing a `&` is an error.

**D-A ∥ Runtime and IR debt.** Structural only, no behavior change. D80 (element places lowered as ordinary `index`/`setIndex` calls, `&m[k]` copy-in/copy-out through a temporary cell; `callNow`, `Box`, `ElementCalls` and D77 go), D78 (one home for value semantics below checker, runtime and stdlib), D81 (walks over values iterative or depth-bounded). Amends `docs/arch/definition.md`.

*Acceptance:* the whole corpus passes unchanged; no re-entrant call path is left; a 3000-deep `Tree` through user `index`/`setIndex`, and a 3000-deep struct held across an `await`, end as a defined panic or `Refusal`, never a host `RangeError`; a differential property ties compile-time constants to the runtime.

**D-B ∥ Checker debt.** Structural only, no behavior change. 3.1's review debt D69–D73.

*Acceptance:* the whole corpus passes unchanged; one structural type key with no module-global counters; `diagnosticsOf` stays lazy (checks only what it is asked for); D73's property tests exist.

**3.6 Concurrency** (5600–5699). Slots; futures held in variables (D45/D49); `select` in both forms; `spawn`; sendable rules at `spawn`; the `inbox` and `futures` (`first`) modules; scheduler introspection for `testing.start`. Measure D44. Spec §3.2, §6, §8, and `spawn` from §9.

*Acceptance:*
- §6's inbox order and receiver rules
- `select` priority and the non-blocking `else`
- a non-sendable `spawn` argument is an error
- spawned instances run on their own snapshots

Disposal effects (losers aborted, block-end release) are 3.7's to assert.

**3.7 Holders** (5700–5799). Holders by reachability (spec §7); block-exit release in reverse creation order; `fn let`/`fn const`/`fn _`; `drop`; statement temporaries; `defer`; `select` losers released; a cycle disposed at the release that orphans it. Spec §3.4, §7. Includes the rest of D59.

*Acceptance:* the following hold as outcomes:
- §7's `processAll` example
- `defer` ordering
- release on every loop iteration
- disposal at an `await`
- a holder cycle disposed at the release that orphans it

**3.8 ∥ with 3.7 — Weak side** (5800–5899). `WeakRef`, `deref`, `disposed()`, `worker.disposing()`, revertible sends and retraction. Spec §6, §7.

*Acceptance:* the §6 death-signal example and §12.3's retraction hold as outcomes.

**3.9 ∥ with 3.6–3.8 — Host boundary** (5900–5999). Extern functions, constants and structs; boundary JSON per the §9 table (the `Decimal` row waits for M4); annotations (§3.16) and `@Waypoint`; the `json` module; the host API (start any function, outcomes, operating a panicked instance); `ista run --host`. Includes debt D33: the first subpath export, with its `.d.ts`.

*Acceptance:*
- The §9 mapping works in both directions, including validation failures.
- A host result of the wrong type panics the instance.
- The §12 examples run under `ista run --host` with a scripted stub host. This is M3's done-when.
