---
description: the code's state before proposal 8 (persistent and ephemeral async) — where function types, the async fit, futures, sendability, await/select/spawn/defer, defaults, segments, snapshots and host futures live today, what is missing (liveness, effect summaries, resident instances, cancellation) and the rewrite's real size; read before planning, implementing or examining an async-kinds phase
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-11
tags: [proposal-8, async, research]
---

# Proposal 8: the code before it

Surveyed on `011d7712`. Paths are under `src/`, abbreviated.

## Front end

- `async` is a boolean on `FunctionDeclaration`, `Lambda` and the syntax `FunctionType` (with
  `isSendable`). An extern struct's handle is a field, a shared struct a node kind of its own.
- No modifier parser: `parseFunctionKeyword`, `parseFunctionType`, `parseExtern`,
  `parseTraitMember`, the `async` lambda parselet and the `followers` table each restate "starts a
  function head" (`'fn' || 'async'`). The order is fixed; a repeat is only the generic 2001.
- Five head printers: the formatter's declarations, types and lambdas, signature help
  (`signatureOf`) and `type-text.ts`'s `functionTypeParts`.
- `defer` (statement) and `spawn` (expression) are keywords with nodes reaching the binder,
  lowering, a `defer` instruction, the runtime, completion and the VS Code grammar. `spawn`'s callee
  steps bind like JavaScript's `new`, the opposite of Rule 9.
- `name name(args)` is today's generic 2001. A deferred-call parselet must leave a range step's
  `by` alone. `contextualWords` already holds `ephemeral` and `sendable`; `readonly` and `ista` are
  in no list, and `ista` is no identifier anywhere.
- Completion's `externWords` lacks `async`, and `followsHandle` copies `followers`. The VS Code
  test covers reserved words only.

## Checker types

- `FunctionType` is `{isSendable, isAsync, parameters, pack?, result}`, where an async type's
  `result` is the awaited `T` but an async declaration's signature result is `Future<T>`: two
  representations, unwrapped by hand (`futureArgument(…) ?? errorType`) in about five places.
- No constructor: six literal builders (written types, lambdas twice, named functions, trait
  requirements, `defer`'s type) and five spread rebuilds (packs, substitution, widening, fitting,
  lowering's fits).
- The function fit (async alike or made async, sendable into plain) lives in about seven places:
  `functionFits`, `functionFitsByParts`, `fitsAsync`, `lambdaAccepts`, `takingAsync`,
  type-match patterns and lowering's fit parts. No qualifier order exists.
- `Future` is known by entity (`wellKnown.future`), built by `futureOf`, read by
  `futureArgument`; declared `extern shared struct Future<T>`.
- Sendability is a boolean switch (`types/traits/sendability.ts`), not memoized. `identityOf` is
  file-private in `types/properties/handles.ts`; `extern ephemeral struct` already parses and is
  confined (`'process'`). A lambda's `isSendable` is inferred from its captures; nothing checks a
  capture against the expected type.
- Settling's `Settling` seam (`{admits, defaultOf}`) has no call-site context. Associated types
  carry no member bound. A trait requirement has no modifier set.
- `typeKey` spells `sendable async fn(…)`; extern keys spell `async fn(A) -> T` (awaited `T`).

## Checker constructs and analyses

- `await` (5022 outside async, 5023 not a future), `select` (5600–5602), `spawn` (5603–5605),
  `defer` (a statement expecting a hand-built `fn() -> Unit`). `main` is found by name and filtered
  silently in `compile.ts`; the CLI and Definition validation each require it async.
- No liveness analysis. `rules/flow/forward.ts` is the one forward-flow engine (one consumer,
  disposal), with no await, call or scope-exit hook. Release points (implicit `dispose`) exist only
  in lowering.
- No effect or call-graph summary. Expansion (`rules/expansion/`) is the precedent: an entry table
  of per-function edges, solved per strongly connected component. `[bodyOf(f), defaultsOf(f)]`
  is already copied twice.
- Defaults are a separate body lowered in the caller; a function value of a shorter type, a spawn
  and a runtime call go through filling entries (tracker B16).
- Two spawn paths: the `spawn` instruction carries the outcome encoder, `instances.spawn` none.

## Runtime and host

- Every driver `await` ends the segment and commits, an already-resolved one included. Nothing
  stays resident between host calls: each `advance` restores the instance from the store. In-memory
  waits are a redesign, not a flag.
- A snapshot is one heap plus every execution's current frames, valid only because one driver runs
  per segment. Re-run state (`random` draws, spawn numbering, `now()`) is per instance; child names
  are `<parent>/<n>`. `NativeContext` has no clock.
- `Futures.resolve` scans every execution; waiters are read from frames, never registered.
- Host externs return `call.pending(token)`; the CLI wraps promises. No cancellation reaches a
  host. An extern's wrapper is an execution of its own (B6).
- `await` and `select` instructions carry no mode; the Definition's `async` is on code entries,
  structural function types and extern keys.

## DG's host fills (a stopped fork, 2026-11-11)

- **Only host fills use:** `HostCall.pending`, `Runtime.fill`, `NativeFutures.fromHost` (→
  `Futures.createHost`), `nativeFuturesOf.resolvable`'s ista guard text, the CLI's token wrapping
  (`cli/host-module.ts`, `run.ts`'s arrivals and next wake).
- **Shared, so they stay:** the persisted `host{token}` future state, `Futures.createFilled`,
  `resolveHost`, `waitsOnHost`, `awaitsHost`, the heap's host-future index and the `arrival`
  wake/replay variant. Live resolvers and the test world's mock answers use them.
- `_hostInput` and `_refuse` serve start entries; the future-extern wrapper's input path also serves
  live futures.
- The Definition's extern entries carry no mark: a deploy-time check needs one, or the checker's
  host-boundary check refuses it from the declaration.
- Rewrite targets: 22 host externs giving ista futures in TS test strings (9 files), 11 in
  `examples/FormBuilder`, 4 in `test/corpus`, and testing's `receive`.
- `recordOutcomeCodecs` knows only `Instance<R>`; three spawn natives repeat one
  `instances.spawn` line.

## Size

| | `.ista` (330 files) | spec | TS-embedded sources |
|---|---|---|---|
| `async fn` | 529, of which 221 `main` (49 awaiting) | 44 (4 `main`) | 279 in 84 files (145 `main`) |
| `Future<` | 310 | 38 | 154 in 61 files |
| `defer` statements | 17, all `defer fn(): …` | 2 | 2 |
| `spawn <call>` | 62 | 8 | 42 |

Embedded sources come as template literals, quoted strings and line arrays. No earlier codemod
was committed. Over or near 400 lines: `segment/index.ts`, `program-checker.ts`,
`body-checker.ts`, `resolve.ts`, `places.ts`, `lambdas.ts`, `forward.ts`, `prelude.ista` (391),
`syntax/expressions/index.ts`.
