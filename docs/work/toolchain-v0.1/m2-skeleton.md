---
description: M2 (skeleton) phase details — scope, falsifiable acceptance criteria and spec-gap defaults for program/check, binder, the Definition contract, the sync path and persistence; read before implementing or examining an M2 phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [plan, m2, binder, definition, runtime]
---

# M2 — Skeleton

**Running the phases**
- 2.1 and 2.2 share no folders, so they run ∥, each in a worktree on a phase branch.
- 2.3 (binder) starts after 2.1 merges, ∥ with 2.2 if 2.2 is still running.
- 2.4 starts after 2.2 and 2.3 have merged. 2.5 follows serially in the main checkout.
- Every phase runs with `qa` and `reviewer`.
- A phase that defines a seam records it in `docs/arch/architecture.md`, and its reviewer's verdict is that seam's contract review. 2.2 does this for the Definition and snapshot formats, 2.3 for the binder's side tables, and 2.4 for the registry handlers and the checker→lowering surface.
- Shared files: the package manifest and lockfile, `.dependency-cruiser.mjs`, `diagnostics/code-blocks.ts`, `AGENTS.md` and `architecture.md`. When two branches change them, the fork that rebases second resolves the conflict.

## 2.1 Program and `ista check`

**Scope**
- `text/`: one `SourceText` factory that strips a leading BOM. Every `SourceHost` calls it, and the BOM handling inside the core is deleted (debt D23).
- `compiler/program/`:
  - Program snapshots over `SourceHost` and `ModuleResolver`: transitive imports, cycles allowed, incremental reuse of unchanged trees
  - the relative resolver
- `compiler/compile.ts`, the pipeline coordinator.
- `stdlib/resolver.ts`:
  - The build ships `.ista` sources in the same layout as `src/`, and the resolver finds them through `import.meta.url`, so the same mechanism works in dev and in `dist`.
  - Record this in the architecture, along with the `stdlib → program` layer edge.
- `cli/` and the `diagnostics/` renderer:
  - commander with a command table, and the `bin` entry
  - `ista check [files…]` (G18): exit code 0 when clean, 1 on errors
  - rendered output: `path:line:col`, code, message, and an excerpt with a caret

**Acceptance**
- Invalid cases give their code at the right span: an unresolved module, and an ambiguous bare path (G17).
- Incremental: after one module is edited, every other module's tree is reused (an identity check).
- E2E: `ista check` exit codes and rendered output across a multi-module graph, on valid files and on syntax errors.

## 2.2 Contract: Definition and snapshot formats

**Scope**
- `definition/` types for the whole language:
  - a flat program: functions by id (an extern is a function-table entry whose body is an extern reference, bound to `Natives` at load; one call node, one mock point, one recording point), types, annotations
  - one IR node kind per lowered construct; spans for traces and waypoints
  - holder and release information for disposal: block exits, function-scoped holdings, statement temporaries, `select` case holdings
  - a format version; canonical JSON with a content hash
- The two decisions everything else rests on, each written with the alternatives it rejects:
  - How a frame addresses its position in the code: an addressable tree plus an explicit continuation stack, or linearized instructions.
  - Whether the IR is typed. Operators are resolved calls, so types are needed only where values cross a boundary: externs, the host boundary, and enum and struct layouts.
- One bigint-aware JSON codec with canonical key order, from a library rather than hand-rolled. Definitions, snapshots and the boundary all use it.
- The snapshot format:
  - executions as frames of data
  - the heap: values, handles, reference counts
  - slots and their waiters, timers, determinism records
  - a format version
  - The slot and timer parts may be amended during M3, through the tech-lead.
- `docs/arch/definition.md`: a construct→IR table covering spec §2–§10. The decisions above also go into the architecture's Decisions.

**Acceptance**
- Every construct the spec lists has a row in the table.
- Property: Definition and snapshot both survive a round trip through canonical JSON losslessly, and the hash is independent of key order.
- Hand-written fixture Definitions validate against the schema: the 2.4 subset program and one §12 example. 2.4's interpreter tests start from these fixtures.
- The reviewer approves the contract.

## 2.3 Binder and prelude

**Scope**
- `stdlib/prelude/prelude.ista`: declarations only (§3.8, §3.10, §3.12).
- `compiler/binder/`:
  - Local binding, cached per tree: top-level symbols in any order, overload sets, block scopes, no hoisting of local functions, the `fn let` name scope, `self` and type parameters, pattern and comprehension bindings, and `is` bindings flowing into `if`/`while` bodies and the right side of `and`, never through `or`.
  - Linking, per Program: exports (a leading `_` makes a name private), named and namespace imports.
  - Every name in value and type position resolves into side tables.
  - Naming conventions (spec §2, §3.1). The binder reads item placement from `syntax/placement.ts` but never re-reports it.
- Name lookups that need types are the checker's: members, methods, ADL, and bare variants in `match`.
- `ista check` reports name errors.

**Acceptance**
- Table-driven invalid cases, one per binder rule: each gives its code at the right span. The rules:
  - undeclared name; assignment to an undeclared name
  - duplicate or clashing import; importing a private name
  - use after the block ends; a local `fn` used before its declaration
  - an `is` binding under `or`; a naming-convention violation
- Valid hand-written programs, plus the prelude itself, bind with zero diagnostics.
- Totality: the binder never throws on the parser's output for mutated corpus.
- Incremental: an edit reuses every other module's local binding (an identity check).
- E2E: `ista check` reports name errors across modules.

## 2.4 Sync path

**Scope**
- Engines are built at full shape, exercised on a subset.
- Checker core:
  - the type model, including generics, function types and nominal structs with named-field construction and field reads
  - bidirectional inference
  - the query surface that lowering consumes
  - diagnostics for mismatches, arity, branch types, `if` without `else` not being `unit`, recursion needing a declared return type, reassigning a `const`, and a `let` that is never reassigned (warning)
- Lowering and the interpreter core: frames as data, and calls through the function table.
- The checker, lowering and interpreter registry `Handler` types, and the checker→lowering surface, are written into the architecture's phase-contracts table.
- Kinds outside the subset are handled by one shared "not yet supported" diagnostic, which the slices remove.
- `ista run <entry>` runs `main` (G19).
- The subset: primitives with their built-in operators, functions, `let`/`const`, `if`/`while`/`return`, and structs as above.

**Acceptance**
- Corpus programs in the subset print the specified outcome under `ista run`.
- Invalid subset programs report the specified codes.
- An unsupported construct gives that one diagnostic, never a crash.
- Totality: the checker never throws on mutated corpus.
- The interpreter runs the 2.2 fixtures without the checker.
- Calls are mockable: replacing a function-table entry changes the callee.

## 2.5 Persistence

**Scope**
- `async fn` and `await`: every `await` commits, segments are atomic, and frames survive at any depth.
- `InstanceStore`: in memory, plus a directory-backed store behind `ista run --store`.
- `Timers`: a real implementation in the CLI.
- The `time` module: the `Time` and `Duration` structs, duration literals, `now`, `at`, `delay`. `delay` is written inside the 2.4 subset, as `at(Time{value: now().value + d.value})`; struct operators arrive with M3.1.
- `runtime.commit`.
- `crashEveryAwait`.
- Refusal of unknown Definition and snapshot versions.

**Acceptance**
- E2E: a program that awaits `time.delay` twice prints its outcome after the delays elapse.
- Restart: run until the first commit, discard the runtime, start a fresh one on the same store, fire its timers. The outcome must match an uninterrupted run.
- With `crashEveryAwait`, every committed snapshot equals the snapshot from a normal run.
- A stored Definition or snapshot with an unknown version is refused with a clear error.

## Spec gaps (proposed defaults; folded into the spec once approved)

| # | Gap | Default |
| --- | --- | --- |
| G17 | Import paths (§3.13) | `./` and `../` resolve relative to the importing file. A bare path names a std module or a path from the project root: the current directory, or from M8 the nearest `ista.json` ancestor. A bare path that matches both is an error. The `.ista` extension is implicit. |
| G18 | `ista check` inputs | The given files, each a root of the module graph. With none, all `*.ista` under the project root, skipping `vendor/` and `node_modules/`. |
| G19 | `ista run` | `ista run <entry> [--store dir] [--host module]`. The entry must declare `async fn main()`. The outcome is printed through the boundary JSON mapping, which covers primitives only until M3.9. |
