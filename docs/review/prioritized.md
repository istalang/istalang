---
description: prioritized refactoring and generalization plan from code reviews
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-10-26
tags: [review, architecture, refactoring, plan]
---

# Prioritized Review Actions

| Priority | Item | Scope | Tracker | Source | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Dead code elimination (frontier.ts, unsupported.ts) | tooling | | by-opus | done (f8f2e91) |
| 2 | Deduplicate leaf helpers (compareCodeUnits, staticName, preludeKey) | definition, language, stdlib | D79, D128 | by-argon, by-opus | done (40dca52) |
| 3 | Split NativeContext into capability interfaces | runtime, stdlib | | by-opus | done (a70160f) |
| 4 | Unify Context-Dependent / Target-Typed Argument Checking (add `accepts` facet) | checker, overloads | D84, D95, D102 | by-argon, by-opus | done (00b8021, 7d5a712) |
| 5 | Fix heldType + must-use for declared structs/enums and `T is Disposable` | checker | D108 | by-argon | done (f87c155, 1bd7b35) |
| 6 | Extract shared checker helpers (remove cross-feature imports, enforce inner layers) | checker | D135 | by-argon, by-opus | done (173dabd) |
| 7 | Generalize Virtual Places (`Index`, `Unwrap`, `Shared.value` into projected/accessor steps) | checker, lowering | D86, D87, D96 | by-argon | |
| 8 | Unify Destructuring Walk & Wrap Counts (single target walker, wrap counts on sites) | checker | D82, D97 | by-argon | |
| 9 | Flow analysis extraction (one flow model / CFG instead of manual switches) | checker | D133 | by-argon, by-opus | |
| 10 | Unify HeapObject table / Frame view / Snapshot builder | runtime | D110, D123, D126 | by-argon | done (6bd863e) |
| 11 | Derive Heap indexes instead of linear scans | runtime | D134, D107, D111, D113 | by-opus | done (0b6a385) |
| 12 | Generalize `@JsonSkip` and JSON forms (use `Default` trait) | checker, lowering | | by-argon | |
| 13 | Spec: JSON crossing as traits (`Encodable`/`Decodable` instead of closed table) | spec, compiler | D140 | by-opus | |
| 14 | Spec: Iterable materialization (`iterate` lazy form) | spec, stdlib | D141 | by-opus | |
| 15 | Spec: Mixed arithmetic (overload matrix vs promotion) | spec, prelude | D142 | by-opus | |
| 16 | Spec: Witness incoherence (chosen per call site) | spec, checker | D143 | by-opus | |
| 17 | Spec: `Shared<T>` roles, Host Handles vs Resource handles, nominal handle declaration | spec, compiler | D105, D139 | by-argon, by-opus | |
| 18 | `Error{...}` trace field (remove hardcoded check, support default field expressions) | checker, syntax | | by-argon | |
| 19 | `worker.disposing()` via Enclosing Function (general way instead of intercepting) | checker, runtime | | by-argon | done (2fba855) |
| 20 | Std types by name in Definition (give extern type entries a role instead) | definition, lowering | D138 | by-opus | done (51f5f6d) |
| 21 | CheckedBody side tables (keep records or elaborated tree) | checker | D136 | by-opus | |
| 22 | Checker memoization (early cutoff for language service) | checker | D137 | by-opus | |
