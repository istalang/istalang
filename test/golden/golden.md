---
description: the goldens' format, groups, fixed inputs and host-scenario steps, and how a pipeline plugs into their runner — read before adding a subject or scenario, changing what a golden records, or running the goldens on a new pipeline
owner: tech-lead
status: active
applies_to: test/golden
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [goldens, testing, scenarios, ir-first]
---

# Goldens

What programs show when run, recorded from the interpreter before the IR-first rewrite deleted it
(`docs/work/ir-first/contracts.md`, "Goldens"), so every later pipeline is held to it.
`golden.sweep.test.ts` runs them; `GOLDEN=update` records instead of checking.

## One home per result

A subject's source keeps what it states, and its golden holds only the rest:

| Group | Subjects | Its source states | Its golden holds |
|---|---|---|---|
| `corpus` | `test/corpus` programs with a `# outcome:`/`# panic:` header | outcome, panic message | panic frame, logs, host calls |
| `regressions` | `src/codegen/regressions/` | the same | the same |
| `amended` | `amended/`, written by hand to the spec amendments | the same | the same, by hand |
| `spec-examples` | spec and guide examples that are whole programs declaring `main` | nothing | everything |
| `form-builder` | FormBuilder's demos with their hosts | nothing | everything: the views are host calls |
| `suites` | `.test.ista` modules, a std module's together, FormBuilder's, and `test/spec-suites` beside its spec code | their assertions | what `ista test` prints of a passing run |
| `scenarios` | `scenarios/*.json` | the steps | what each step showed |

A group is one file, `<group>.json`, keyed by subject; a subject with nothing more to record has no
entry. Keys follow the source's path, except spec examples: `document § section #n`, since lines
move with every edit.

## What a run shows

- **Ending:** `outcome` (JSON text), or `panic` and `frame`, the innermost frame in the program's
  own modules, its file relative to the subject's directory (a std frame moves with the std's
  code), or `unsettled` with the state a run stopped in.
- **`logs`:** `level message fields`, without instance or time.
- **`hostCalls`:** `key [arguments]`, bigints marked `n`.
- **Disposal** shows only through what it does: the logs and host calls of `dispose`.

## Fixed inputs

The clock is manual: it starts at 0 and moves only to the next due timer, or where a scenario sets
it. The seed is 32 zero bytes. A suite runs as `ista test` runs it, which fixes both per test.

## Scenarios

`scenarios/<name>.json` names a program beside it, an optional host module (the `ista run --host`
format: externs by key, arguments spread), and steps:

| Step | Does | Shows |
|---|---|---|
| `{"start": run, "function"?, "arguments"?, "crashEveryAwait"?}` | starts `main` or the function a key names | the run's state, spawned, logs |
| `{"wake": name}` | advances a stored instance | its state, spawned, logs |
| `{"inspect": name}` | reads a stored instance | its state, `waitingAt` |
| `{"retry": name}`, `{"terminate": name}` | as the host API does | its state, logs |
| `{"stored": true}` | lists the store's instances | `stored` |
| `{"clock": ms}` | sets the clock | — |
| `{"restart": true}` | a fresh runtime over the same store, clock and host | — |

Every step also shows the host calls since the step before, and what the contexts a live run drives
reported by themselves: `reported` logs and `unheard` panics. A refused step shows `refused` and its
reason. A state is `finished` (outcome JSON text, or null with no codec), `panicked` or `terminated`
with `frame`, `waiting` (`until`, `watching`) or `ready`.

## A new pipeline

`pipeline.ts` is the only module that knows the pipeline: a new one replaces it, keeping its
exports, and sets `runsAmendments`, which turns the `amended` group from expected failures into
checks. A golden changes only with a named spec amendment (`docs/work/ir-first/design.md`), cited
where it changes.
