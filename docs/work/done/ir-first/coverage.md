---
description: the coverage map of the IR-first rewrite — every test importing code R1 deletes, and what covers its behavior after R1 (a golden, a scenario, an .ista test, a rewrite in R1, or dropped); read before deleting or rewriting a test in R1
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-17
last_updated: 2026-11-17
tags: [coverage, tests, goldens, ir-first]
---

# IR first — coverage map

R1 deletes `src/runtime`, `src/live`, `src/codegen`, `src/definition` and `src/compiler/lowering`.
Each test below imports them, and what covers its behavior after R1:
- **golden, scenario:** `test/golden/` (`golden.md`), already green on the old pipeline;
- **R1:** rewritten in R1 on the new unit. Its expectations are stated in the test itself, so it
  needs no interpreter to replay, and it stays readable at `ir-first-base`;
- **dropped:** tests machinery that no longer exists.

## Covered by goldens and scenarios

| Test | Covered by |
|---|---|
| `codegen/differential.sweep.test.ts`, `differential.test-kit.ts` | every golden group. Two backends no longer exist, so the cross-check passes to a property R1 adds: every golden program shows the same under `crashEveryAwait` |
| `runtime/scheduler/wake.sweep.test.ts` | `corpus` goldens |
| `runtime/scheduler/resident.sweep.test.ts` | the same `crashEveryAwait` property, and the snapshot round trip (design, "Verification") |
| `runtime/scheduler/segment/limits.test.ts` | `amended/recursion-limit.ista` |
| `runtime/boundary/host-api.test.ts` | scenarios `start-by-key`, `extern-constant`, `retry`, `terminate`, `timer`; R1 for the int/bigint crossing and reserved externs |
| `runtime/scheduler/wake.test.ts` | scenarios `timer`, `restart`, `crash-every-await`; R1 for segment boundaries of eager callees |
| `runtime/scheduler/segment/end-instance.test.ts` | scenario `terminate`; R1 for disposal of held calls and abandoned waits |
| `runtime/scheduler/live-run.test.ts`, `logs.test.ts` | scenarios `host-future`, `timer`, `crash-every-await` (reported logs); R1 for rejected promises and live timers |
| `runtime/host/host.test.ts` | scenarios (panic frame, outcome JSON); R1 for refusals of bad Definitions, seeds and failing stores |

## Rewritten in R1, on the new unit

The rules these tests asserted that a program can observe are Istalang now: cases of
`test/suites/<area>.test.ista` (each must pass; the corpus sweep runs them), corpus programs where a
rule needs a whole program, and host scenarios (`scenarios/`, in `test/golden/`). What the old test
asserted and R1 doesn't show is a gap below. *Left out* names rules no program can observe.

Beside the goldens, the corpus sweep holds every subject to its checks (`test/sweep/checks.ts`):
the same outcome with its contexts crashing at every await, read back into a reshuffled build
(`crash-every-await`); its ending on real time, as `ista run` runs it (`real-time`); the same
behavior and Definition once formatted (`formatting`); one Definition however types were numbered
(`numbering`); and every broken mutant of its code refused by the ownership verifier
(`ownership`).

| Tests | New unit | Ported to |
|---|---|---|
| `definition/**` | the new Definition's schema, validation and format | left out (schema, codec, values, references): `definition/formats/codec.test.ts`, `validation/index.test.ts`, `values/{equality,replacing}.test.ts`, `validation/ownership.sweep.test.ts` |
| `compiler/lowering/**` | the new lowering; `counted` becomes the typed IR's reach facts | `suites/functions` (defaults left out, a deferred call's default, struct/variant/std defaults, a constant of another module, a namespace's function constant spawned, a `select` with only `else`); trait objects, recursive names, table keys, struct layout, extern keys: their own tests, kept. Left out: closures' entries and cells, counted and plain registers, code-writer labels. Not ported: `!` (every `!` warns, 5411, which `ista run` and `ista test` print; its panic text: `test/unions/normalization.test.ts`), the generated defaults-written-out property, traces of defaults (`stdlib/prelude/error-trace.test.ts`) |
| `codegen/literal.test.ts`, `live/traces.test.ts`, `runtime/interpreter/trace.test.ts` | codegen: exact literals, frames read off the JS stack, traces from a prologue | `suites/functions` (an Int beyond a double, -0, a large Float); every golden's `frame`; `stdlib/prelude/error-trace.test.ts`. Left out: NaN and infinity literals, which no constant holds (5026) |
| `codegen/form-builder.bench.ts`, `int-loop.bench.ts`, `built-program.test-kit.ts` | the perf gates' benches on the new codegen | left out: speed, no rule |
| `live/program.test.ts`, `live/arrivals.test.ts` | the one host binding: start refusals, two events arriving together | scenario `start-by-key`; the same object given again: `runtime/boundary/host-identity.test.ts`; a start whose outcome JSON can't hold: `runtime/boundary/starts.test.ts`. Left out: arrivals' turns |
| `runtime/boundary/host-{codecs,constants,identity,resolvers,resources}.test.ts` | the host binding: codecs, constants, frozen identity, resolvers, resources | scenarios `host-codecs`, `extern-constant`, `extern-constant-type`, `callback-holdings`; identity: `runtime/boundary/host-identity.test.ts`; resolvers (`call.resolver()`, which a scenario's host module, taking its arguments only, can't reach): `runtime/boundary/host-resolvers.test.ts`; resources kept across commits and read back, disposed on termination and by the host's `dispose`, retracted through a `Revertible`: `runtime/boundary/host-resources.test.ts` |
| `runtime/host/contexts.test.ts`, `deploy.test.ts` | contexts and the store in the one run | corpus `contexts/{call-answers,call-panics,call-invocations,runtime-disposable,invalid-call-sendable,timer-readied-context}`; the host steps the scenarios lack (commits while the live run waits, resuming at the next open, a due timer on open, disposing a `Runtime`, a released `Call`, a call's holdings at its instance's end, a context's unheard panic): `runtime/host/contexts.test.ts`; `deploy` (store writes): `runtime/host/deploy.test.ts` |
| `runtime/scheduler/spawn.test.ts`, `instance/{awaitables,callbacks,races,waits,on-cancel,futures,context-constants,instance-ends}.test.ts`, `callbacks.test-kit.ts`, `futures.test-kit.ts` | the run's primitives and the services written in Istalang | `suites/{awaitables,callbacks,waits,instances}`; corpus `contexts/constant-{once,reads-itself,temporary,read-while-made}`; scenarios `spawn-panic`, `spawn-crash-rerun`, `spawn-inspect`, `instance-ends`, `callback-holdings`; `runtime/host/instance-ends.test.ts`: outcome disposal on terminate, a root's defers before its outcome, context constants disposed at their instance's end, an isolated child's panic terminating it, a wait's commit stopping its wakes, a parent woken on a fresh runtime. Left out: a future resolving once, host answers (futures) |
| `runtime/scheduler/instance/{slots,weak-side}.test.ts` | the same rules as properties over the new slots and weak references | corpus `concurrency/slots`, `weak-side/{weak-refs,live-weak-refs}`, fixed sequences; the properties over random operations are not ported |
| `runtime/lifetimes/{collector,counts,disposal,holders}.test.ts`, `lifetimes.test-kit.ts` | the collector and counts of the one run | `suites/disposal`; corpus `holders/{slot-round,dispose-body-locals,dispose-not-preempted}`, `weak-side/deref-in-round`. Left out: counts, holder walks, which kinds are disposable |
| `runtime/lifetimes/{oracle,native-audit}.test{,-kit}.ts`, `test/lifetimes-oracle.sweep.test.ts`, `cli/commands/test.sweep.test.ts` | the ownership verifier, and capabilities checked when natives are bound | left out: the oracle and audit (`definition/validation/ownership.sweep.test.ts`); `lifetimes-oracle.sweep` and the std suites (each passes in the corpus sweep) stay |
| `runtime/lifetimes/{in-place,value-semantics,written-json,shared-values}.test.ts`, `in-place.test-kit.ts`, `in-place.bench.ts` | in place if unique, and fast-check aliasing | `suites/aliasing`; corpus `values/{outcome-after-defer,outcome-after-constant-disposal,outcome-after-cleanup,context-call-copies,nested-copies,map-key-copies,self-insertion}`; the fast-check aliasing property `runtime/run/aliasing.test.ts`. Left out: written-JSON caches, writes over counted holders, shared snapshot values. Not ported: mocks isolated across instances |
| `runtime/snapshot/{snapshot,check}.test.ts` | the new snapshot format and what reading one back refuses | `runtime/snapshot/read-back.test.ts`: an unknown version or shape, a Definition the store lacks, an object the snapshot doesn't hold, a frame that doesn't fit its Definition (pc, entry kind, register count), an instance the store lacks; scenarios `restart`, `crash-every-await` read snapshots back |
| `runtime/natives.test.ts`, `stdlib/{positions,ranges}.test.ts`, `stdlib/prelude/natives.test.ts`, `stdlib/random/natives.test.ts`, `stdlib/std-externs.test-kit.ts` | the natives on primitives, after L moves some to Istalang | their tests, kept; the engine's stack refusal: `amended/recursion-limit`. Left out: string, integer and array length refusals, past what a test can build |
| `runtime/testing/{mocks,run-tests}.test.ts`, `testing.test-kit.ts` | `ista test` and mocks on the new pipeline; every suite passes in the corpus sweep | their tests, kept |
| `stdlib/futures/futures.test.ts`, `stdlib/runtime/{delegate,job-serving}.test.ts`, `delegate.test-kit.ts` | futures, jobs and `delegate` in the one run | their tests, kept |
| `runtime/runtime.test-kit.ts`, `cli/cli.test-kit.ts` (its heap check) | a test run and the CLI's heap check over the new run | helpers, no rule |
| `compiler/compile.test-kit.ts` (`compiledText`, `compiledDefinition`), `compile.sweep.test.ts` | compiling to the new Definition. Its checker helpers (`checkedAfterStd`, `diagnosedAt`) stay | helpers; the sweep stays |
| `stdlib/prelude/prelude.test-kit.ts` (`mainGives`, `mainOutcome`) | running a program to its outcome on the new pipeline | a helper, no rule |
| `test/fmt-preserves-behaviour.sweep.test.ts` | formatting keeps behavior, run on the new pipeline | stays, unchanged |

## Staying, through rewritten helpers

These test the checker, the std or the language. They reach the old pipeline only to run a program
to its outcome, through `mainGives` (`stdlib/prelude/prelude.test-kit.ts`), `startToEnd` with
`testRuntime` (`runtime/runtime.test-kit.ts`), `compiledText` (`compiler/compile.test-kit.ts`),
`decodeJson` on an outcome's text, or the test run of `runtime/testing/testing.test-kit.ts`. Once R1
rewrites those helpers, they stay, unchanged but for imports:

- `compiler/checker/`: `constructs/closures/function-values`,
  `constructs/declarations/aliases/{recursive-aliases,recursive-trait-objects}`,
  `constructs/expressions/literals/indented-values`, `constructs/expressions/structs/{structs,variants}`,
  `constructs/patterns/{parameter-patterns,type-patterns}`, `constructs/patterns/walk/kinds/variant-calls`,
  `desugaring/deferred-calls`, `list-separators`, `resolution/applying/joint`,
  `resolution/choosing/literal-arguments`, `resolution/conformance/{conformance,field-getters}`,
  `rules/computation/index`, `rules/{getters,keyed-reads}`, `types/fitting/holds`,
  `types/identity/{recursive-holdings,recursive-unfolding,recursive-uses}`,
  `types/inference/{relate,settle}`, `wiring/body/{constraint-scope,scope-protocol}`;
- `compiler/parser/grammar/declarations/import-lists`,
  `compiler/proposal-{5,7}-behaviour`, `compiler/proposal-13-transients{,-refusals}`;
- `stdlib/json/json-union`, `stdlib/prelude/{appending,error-trace,iteration}`;
- `test/written-types.test-kit.ts`.

Tests using only `diagnosedAt` or `checkedAfterStd` (the rest of `compiler/checker/**`,
`compiler/compile.test.ts`, `test/computed/**`, the editor's navigation kit) are untouched.

## Staying, through the CLI

These run `ista` in process (`cli/cli.test-kit.ts`) and stay as the CLI moves to the new pipeline,
the kit's heap check rewritten in R1: `cli/cli.test.ts`, `cli/commands/{fmt,lsp,run,run.sweep,
run-host,run-host-process,test}.test.ts`, `editor/vscode-client/server-command.test.ts`,
`test/examples.test.ts`. Rewritten in R1, since R1 changes what they assert:
`cli/commands/build.test.ts`'s refusals of ista code and of what only the interpreter has, which
compiled code now runs.

## Rewritten in R1, outside the deleted folders

| Test | Why |
|---|---|
| `compiler/checker/surface/constant-form.test.ts` | builds and compares the old Definition's values (`definition/values`) |
| `compiler/proposal-8-behaviour.test.ts` | reads the old Definition's code-entry modes |
| `compiler/syntax/declarations/field-defaults.test.ts` | reads the old Definition's functions |
| `test/unions/variance-conversions.test.ts` | reads snapshots back (`runtime/snapshot`) |
| `test/definitions/{subset,broadcast,fixture-kit}.ts` | hand-written old Definitions. `subsetSource` and `subsetOutcome`, which `check.test.ts` and `run.test.ts` read, stay |

## Dropped

| Test | Why |
|---|---|
| `runtime/host/host.bench.ts`, `runtime/scheduler/wake.bench.ts` | the old host's and scheduler's speed |
| `runtime/scheduler/instance/{heap,unheld,instance-names}.test.ts`, `heap.test-kit.ts` | the old heap's indexes and walk, replaced by the root walk |
