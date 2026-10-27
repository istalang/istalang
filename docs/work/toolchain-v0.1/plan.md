---
description: v0.1 toolchain plan — process, milestones and phases from scanner to packages; read before forking or reviewing any phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-27
tags: [plan, roadmap]
---

# Toolchain v0.1 — plan

Spec: `docs/spec.md` · Architecture: `docs/arch/architecture.md` · Tracker: `docs/work/tracker.md`

## Process

**Shape.** First the syntax, then an end-to-end skeleton, then feature slices. A slice cuts through checker, lowering and runtime, and is proven through `ista check` and `ista run`. *Why:* the persisted interpreter is the riskiest part, so it runs in M2 rather than last. From then on every slice is tested against a working pipeline.

**Contracts first.**
- M1 fixes every syntax node kind. M2.2 fixes the Definition schema and snapshot format for the whole language; a cold reviewer checks that phase's contract before any code.
- Slices then only add handlers to the per-kind registries. Those registries are the merge seams.
- Contract amendments go to the tech-lead, who decides and tells the affected branches.
- Every surface that parallel slices share has exactly one owner, named in the detail files. Consumers stub against the contract; they never wait for the owner.

**Per phase.**
- One implementer fork, then a cold `qa` and a cold `reviewer`. Forks raise issues directly with the human, and report to the tech-lead only after the human approves the phase.
- A serial phase works in the main checkout. Phases marked ∥ use worktrees, at most 3 at a time; when one merges, the next starts.
- If main has moved, a fork rebases onto it itself and reports again. The tech-lead runs e2e `qa` after each ∥ group.
- Phase branches are rebased onto `main` and fast-forward it once the human approves. Each milestone ends with a merge review of `main` since the previous milestone.

**Approval.** Before a milestone starts, each of its phases gets a detail file next to this plan (acceptance criteria, spec gaps with defaults), and a human approves it. From M3 on, each slice sweeps its own spec gaps with the human as its first step.

**Corpus.** `test/corpus/` is the shared e2e input:
- spec examples, extracted from `docs/spec.md` by a script and never copied by hand
- hand-written valid and invalid cases kept beside them

## Milestones

**M1 — Syntax.** *Done when:* the scanner is lossless, the parser is total on random input, and every spec example in the corpus parses with zero diagnostics.
1. Scaffold (package, tsconfig, Biome, vitest, AGENTS.md), `text/`, `diagnostics/`, the corpus extraction script, and the scanner (every §2 lexical form).
2. Parser machinery (cursor, recovery, speculation), types, patterns and expressions: the Pratt table, generic-call disambiguation, struct literals, lambdas, comprehensions.
3. Parser layout, statements, control flow, declarations and modules.

**M2 — Skeleton.** *Done when:* `ista check` reports syntax and name errors, and `ista run` runs a program that awaits `time.delay`, resuming it from a snapshot restored in a fresh runtime.
1. Program snapshot, seams, resolvers, the pipeline coordinator, and the CLI skeleton with `ista check` (syntax errors across a module graph).
2. Contract: the Definition schema (every construct, including anonymous-struct and capture layout) and the snapshot format, both versioned. Delivered as types plus a construct→IR mapping doc, and reviewed before 2.4.
3. Binder and prelude declarations; `ista check` reports name errors.
4. Sync path, with full-shape engines covering a small subset: the checker core (type model, inference, registries), lowering, and the interpreter core (frames as data, calls through the mockable function table). `ista run` runs primitives, functions, `let`/`const`, `if`/`while`, `return` and basic structs.
5. Persistence: `async`/`await`, atomic segments, snapshots through `InstanceStore`, `Timers`, the `Time`/`Duration` structs and `time.now`/`at`/`delay`, `runtime.commit`, and `crashEveryAwait`.

**M3 — Feature slices** (details: `m3-slices.md`). *Done when:* every §12 example compiles and runs under `ista run --host` with a scripted stub host, and each spec section's corpus cases produce the specified diagnostics and runtime behaviour.
1. ∥ with 2 — Generics and calls: generics, overloads, ADL, operators as functions, traits and `Sendable`, conversions, aliases, enum declarations, `Optional` and implicit wrapping; the corpus harness.
2. ∥ with 1 — Values: structs, tuples, methods, value semantics, `const` and `&`.
3. ∥ Collections: arrays, maps, ranges, indexing, comprehensions, `for`.
4. ∥ Patterns: `match` and exhaustiveness, `is`, `?.`/`??`/`?`, `Result` and `Error`, `drop`, `panic`.
5. ∥ Closures: lambdas, local functions, captures, `Shared`/`$`.
D. Two ∥ structural debt forks before 6: runtime and IR (D80, D78, D81), checker (D69–D73).
6. ∥ with 9 — Concurrency: slots, futures, `select`, `spawn`, `inbox`, `futures`, scheduler introspection.
7. Holders: holders by reachability, block release, `fn let`, `drop`, `defer`.
8. ∥ with 7 — Weak side: `WeakRef`, `disposed()`, `disposing()`, revertible sends.
9. ∥ with 6–8 — Host boundary: externs, boundary JSON, annotations, `json`, host API, `ista run --host`.

**M4 — Standard library** (details: `m4-m5.md`, built together with M5). The remaining §3.8 modules, partitioned by module group and built ∥. *Done when:* every listed function exists and is exercised e2e.

**M5 — Test runner** (details: `m4-m5.md`). The `testing` natives, the binder rule that only `.test.ista` modules may import `testing`, the in-language test library (`test`, `group`, setups, `FakeClock`, `FakeQueue`, assertions) and `ista test`. *Done when:* §10's suite runs, including clock-driven expiry, mocks and `crashEveryAwait`.

*MVP boundary: M1–M5 compile, run and test programs end to end.*

**M6 — Formatter.** `ista fmt` and the formatting API. *Done when:* output over the corpus is idempotent and preserves both the tree and the comments.

**M7 — Language service and LSP.** *Done when:* every provider answers correctly on corpus fixtures, and the VSCode extension starts the server.
1. Workspace snapshots, diagnostics, symbols, folding, syntactic semantic tokens, and formatting.
2. Hover, go-to-definition, references, rename, completion, signature help, and inlay hints for inferred types.
3. `.vscode/extensions/ista/`: the client, beside the TextMate grammar already there.

**M8 — Packages.** `ista.json`, minimal version selection, the lockfile, `ista vendor`/`verify` and the vendor resolver. *Done when:* builds are reproducible from the vendor folder, and `verify` catches hand edits.
