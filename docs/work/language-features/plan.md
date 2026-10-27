---
description: plan for the agreed new language features after M4/M5 and before M6 — process, phases, order under the 3-parallel cap, shared surfaces and owners, code ranges; read before forking or examining a language-features phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-27
last_updated: 2026-10-27
tags: [plan, language]
---

# Language features — plan

Features, decisions, landing points and gaps: `features.md`. Spec: `docs/spec.md`.

## Process

**One contract phase, then six partitions, at most 3 at a time.** *Why:* every feature adds tokens and node kinds to the same exhaustive tables. Fixing them once, with frontier entries, lets the partitions run in parallel by replacing entries, as M1 and M3 did.

- **When:** after M4's merge review lands, and before M6 and M7: the formatter must cover the new syntax, and M7's hover reads docstrings. M8 (packages) doesn't touch the language, so it can take a free slot alongside.
- **Per phase:** the gap sweep with the human first (§ defaults in `features.md`), then an implementer fork, a cold `qa` and a cold Claude `reviewer`. L0 skips `qa`: it changes no behaviour, and the corpus covers it.
- **Merging:** forks rebase and fast-forward `main` themselves. The tech-lead runs an e2e `qa` after each parallel group. The plan ends with a merge review of `main` since L0's base.

## Phases

| Phase | Scope | Accept |
| --- | --- | --- |
| **L0** Contract (structural) | All new tokens, node kinds and fields, each with a frontier (5000) entry in every exhaustive table. The operator table as data (associativity, function, operand rules). Parselet tables for patterns and types. Splits of the over-cap files the partitions grow (`syntax/expressions.ts`, `checker/check.ts`, `lowering/tables.ts`, `scheduler/instance.ts`, `segment/index.ts`, `testing/world.ts`). | Corpus and tests unchanged; each new construct reports 5000; no file over 400 lines |
| **L1** ∥ Calls | F1 rest and spread, F4 named arguments over the parameter struct, F7 plain fits async. Structural first: one signature model, one function-type equality. | `format` is one rest declaration; `retry(backoff: 2s)` skips a middle default; the D189 pairs are gone; no `f/N` entries |
| **L2** ∥ Instances | F8 `spawn` → `Instance<T>`, `result()`; F3 `isolate`; the production watch resolver; `Started` → `Instance`. | A parent awaits a child's outcome under `ista run` and across a snapshot; `isolate` gives `Err` on a panic; `start`'s overloads are gone |
| **L3** ∥ Trait objects | F11 `any T` by enum dispatch, downcast patterns. Structural first: exhaustive `Type` switches. | Mixed `Array<any T>` dispatches correctly across a snapshot; an object-unsafe trait, a `match` without `case _`, and an unsendable `spawn` of `any T` are refused |
| **L4** ∥ Holds and labels | F5 `hold`/`hold(name)`, labels, labelled `break`/`continue`; the migration from `fn let`. | §7's examples hold with `hold`; `hold(outer)` releases when the loop ends; no `fn let` is left |
| **L5** ∥ Operators and patterns | F2 `**`, F12 `!`, F13 (bitwise, chains, `in`, step), F10 (or, array, range patterns). | `-2 ** 2` is a syntax error; `math.pow` is gone; `none!` panics; exhaustiveness covers or-patterns and array lengths |
| **L6** ∥ Text | F6 templates (multi-line, interpolation, then tagged once L1 and L3 have landed), F9 docstrings. | The scanner stays lossless on multi-line tokens; `` `a ${x}` `` calls `toString`; docstrings attach to their declaration |
| **L7** ∥ Variadic generics | F14 tuple packs (pass-through only) over L1's signature model. | `mock` and `calls` are one declaration each; `fn logged<A, R>(f: fn(...A) -> R) -> fn(...A) -> R` wraps functions of any shape; a pack used as anything but a pass-through is refused |

**Order:** L0 → {L3, L1, L2} → {L4, L5, L6, L7} as slots free. *Why:* the high fan-in and risky parts (type system, call model, runtime) start first, where a discovery is cheapest. L7 needs L1; L6 starts last, because tagged templates need L1 and L3.

## Shared surfaces and owners

| Surface | Owner | Consumers |
| --- | --- | --- |
| Tokens, node kinds, operator table, frontier entries | L0 | all |
| Signature/slot model, call fitting | L1 | L2, L3, L6, L7 |
| D189 std clean-up (plain/async pairs) | L1 | L2 writes its new APIs single after L1, or as pairs L1 deletes |
| `Instance<T>`, watch resolver, snapshot status/watch shape | L2 | — |
| `Type` union, synthesized enums in the Definition | L3 | L6 (`any Stringable`) |
| `keep` target scope (definition.md amendment) | L4 | — |
| `|` token semantics (or-pattern, bitwise) | L5 | — |
| Scanner multi-line tokens | L6 | — |

**Diagnostic ranges.**

| Phase | Parser | Checker |
| --- | --- | --- |
| L0 | 2026–2049 | — |
| L1 | 2050–2069 | 5115–5149 |
| L2 | — | 5606–5649 |
| L3 | 2150–2169 | 5150–5199 |
| L4 | 2130–2149 | 5706–5749 |
| L5 | 2070–2099 | 5411–5449, 5029–5059 |
| L6 | 2100–2129 (scanner 1011–1029) | 5060–5079 |
| L7 | 2170–2189 | 5080–5099 |

## Decided

- **D136:** these features keep the per-construct side tables; the elaborated-tree decision stays with M7.
- **Variadic generics:** level 1 (tuple packs) is L7. Level 2 (mapped packs) is out, so setups keep their per-arity overloads, and mixed-type values use `any Stringable`.

## Out of scope

Mapped variadic generics (level 2); upgrading running instances to a new version; queries; idempotency keys for extern calls; compensation-only `defer`. Each is filed when the plan is approved.
