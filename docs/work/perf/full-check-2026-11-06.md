---
description: cold end-to-end compile profile (scan, parse, bind, check, lower) of the form builder and std tests at f999c924, after P22–P24 — phase times, subsystem shares, call counts against distinct keys, and ranked root fixes (tracker P22, P25, P32–P37); read before optimizing the full-check or lowering path
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-06
last_updated: 2026-11-06
tags: [performance, profiling, checker, lowering]
---

# End-to-end compile profile: scan → parse → bind → check → lower, cold (main f999c924, 2026-11-06)

> Rerun with the tools in `scripts/profile/` (`README.md` in this folder says which answers what). The distinct-key counts came from a one-off instrumented `dist`, kept out of the repo because it patches built JS by exact text.

## What was measured

All runs are on main `f999c924` with `dist` built. The machine load average was about 2.

- **Cold end to end** (`npm run profile:cold`): one compile per fresh process, with no previous program and no cache. The profiler starts after module imports. Each workload ran 5 times and the 5 CPU profiles are merged.
  - **fb:** the form builder plus the synthetic `main-entry` (as in `npm run profile`), through `compileProgram`.
  - **std-tests:** every std `*.test.ista`, through `compileTests`.
- **Warm full checks** (`npm run profile:check`), each a fresh `loadProject` plus `diagnose`:
  - `fb-warm`: 10 repeats;
  - `std-tests`: 5;
  - `decimal16`: the decimal tests ×16, 3 repeats;
  - `corpus`: all 267 corpus programs;
  - `every-std`: 5 repeats.
- **Other passes:**
  - exact call counts, from V8 precise coverage;
  - allocation sampling, with collected objects included;
  - an instrumented `dist` copy that counts calls against distinct keys.

## Cold phase times (ms, mean of 5 fresh processes)

| Workload | Scan + parse | Bind | Check | Lower | Total |
|---|---|---|---|---|---|
| Form builder | 67 (4%) | 18 (1%) | 516 (31%) | **1,086 (65%)** | ~1,690 |
| Std tests | 68 (15%) | 17 (4%) | **245 (53%)** | 136 (29%) | ~465 |

Lowering is most of the form builder's compile. Its own files are only 9% of its time; the rest is checker type machinery it calls: instantiation, substitution, unions and type keys.

## Subsystem shares, cold end to end (inclusive; subsystems overlap)

| Subsystem | Form builder | Std tests |
|---|---|---|
| Type keys (`type-keys`, `recursive-terms`, `term-signatures`, `identity`) | **43.3%** (self 34.5%) | 4.8% |
| …of which canonical keys of recursive types (`recursive-terms`, `term-signatures`) | **37.7%** (self 25.8%) | 1.7% |
| Rebuild (`substitution`, `type-parts`) | 40.8% | — |
| Unions (`unions`, `union-members`, `recursive-types`) | 38.5% | — |
| Conformance (`conformance`, `witness-outcomes`, `shortfalls`, `declared-witness`) | 17.0% | 13.6% |
| Overload resolution (`choice`, `applicability`, `binding`, `candidates`) | 15.3% | **24.8%** |
| Lowering type names (`names.spelledType` → `extern-key.keyTypeText`) | 6.7% | — |
| Noted constraint checks (`type-parameters`) | 6.9% | 4.5% |
| Scan + parse | 3.4% | 12.1% |
| Syntax tree walks (`syntax/`) | 2.6% | 7.4% |
| Bind | 1.5% | 4.5% |
| `memo` helper, self | 9.4% | 4.5% |
| GC | 4.3% | 7.2% |

## Bottlenecks, ranked

### 1. Canonical keys are recomputed for every new type object: ~38% of the form builder compile

- **Counts:** over a full form builder compile, `canonicalKey` runs **20,046** times on **20,046 distinct objects**, but those objects have only **1,067 distinct structures** (18.8× repetition). The check alone gives 3,354 calls for 462 structures.
- **Cost per call:** each call builds a fresh `TermGraph` (`slotOf` → `#isTerm` → `typeChildren`) and minimizes it (`minimize` → `refinedRanks`). Even though every recursive type it reaches is already a minimized graph, it is re-minimized.
- **Entry points:**
  - `folded` → `typeKey`: 17.5%;
  - `unions.keyOf` → `typeKey`: 14.1%. Both come from `rebuilt` → `unionOf`, which keys every member and then the union;
  - `fit.exact` → `isAssignable`: 5.4%;
  - lowering's `type-table`: 2.5%.
- **Allocation:** about 1 GB is allocated per form builder check, and canonical keying is about 25% of it. `#isTerm` alone (the `#holdsPlaceholder` Map) is 7.2%.
- **Root cause:**
  - The per-object memo (`ownKeys`) never hits, because substitution keeps building new objects of the same structure.
  - The harness's check counts show 19,414 type objects for 1,677 type keys; lowering's show 44,996 for 2,714.
  - A recursion-holding key is the costliest kind to compute from scratch.
- **Fix:**
  - Memoize the canonical key by a structural **pre-key**: the type spelled with each reached recursive node as (graph identity, node) and each leaf by its own key.
    - Graphs are immutable and already minimized, so two types with the same pre-key have the same unfolding and therefore the same canonical key. Correctness holds by construction.
    - Give it one home in `keyAt` and `canonicalKey`, weak-keyed by the graph so it doesn't leak in the LSP.
    - It should remove about 95% of canonical keying: roughly 30–35% of the form builder compile and 20% of its check.
  - The bigger alternative is hash-consing types at construction: one object per structure, so every per-object memo hits (`ownKeys`, `holdsRecursion`, `parametersIn`).
  - This subsumes most of P32 (lowering's `folded` → `canonicalKey`).

### 2. Substitution rebuilds unions and re-normalizes them: `rebuilt` → `unionOf` is 33% of the form builder compile

- **Counts:** `substitute` runs 295k times per form builder check, with 115k `mapChildren` calls. `unionOf` runs 5.3k times per check, each calling `normalizedMembers` (7.4% of the check) and `folded`.
- **Fix:**
  - #1 removes the key cost inside.
  - What remains is normalizing a rebuilt union whose member keys are the same as a union already built. Memoize `unionOf` by its members' keys (normalize at construction once per key), so a rebuilt union with equal members is the one union.
- **Smaller item:** `requirementCandidates` walks `computedTypesIn` and `anyTypesIn` per candidate. That is 146k calls each per check and 3.4% of the check. Memoize both per type object, as `parametersIn` is.

### 3. Conformance is still searched per root check: 17% of the form builder compile, 35.6% of its warm check, 13.6% of the std tests (P22's remainder)

- **Counts over a full form builder compile:**

  | Call | Calls | Distinct | Repetition |
  |---|---|---|---|
  | Root searches | 3,805 | 317 goals | 12× |
  | `chooseWitness` | 7,966 | 458 (type, required function) | 17.4× |
  | `meetsStructConstraints` | 8,568 | 808 | 10.6× |

- **Entry points, as shares of the warm check:**
  - trait-object conversions (`fit.convertedInto` → `trait-objects.meetsAny`): 14.1%;
  - noted constraint checks (`#check` → `meetsStructConstraints` 13.6%, `meets` 2.3%);
  - `applyCall` → `instantiate`: 2.3%;
  - `silent-choice`: 2.0%;
  - host boundary: 1.4% here, but 7.9% of the corpus.
- **Where the time goes:** about 70% of conformance is choosing witnesses by full overload resolution: `chooseWitnessAmong` → `chooseAsValue` (18.6% of the check) and `witnessCandidates` (6.5%).
- **Fix:**
  - P22 as planned: a program-wide EntryTable of root goals, keyed by `goalKey` plus `toHost`/`onValues`, with a stand-in for the derived-codec cycle.
  - Plus a sibling table for `chooseWitness` keyed by (type key, required function), so each witness is chosen once per program.
  - Reporting sites recompute only failures.
  - Expected: conformance about ÷10.

### 4. Overload resolution runs full applicability on every candidate: 25% of the std tests, 30% of decimal16, 15% of the form builder

- **Per call:**
  - `takenBy` → `argumentsInapplicability`, with a new `Inference` per candidate. On the decimal tests that is about 4–5 candidates per call: 28k `takenBy` per run.
  - `argumentSlotsOf` is rebuilt by 5 callers from the same `(parameters, binding)` (resolve, lambda arguments, applicability, and argument fit twice). That is 38.7k calls per form builder check and 48k on decimal16: 1.9–4.1% self, plus a Map and flatMap allocation each.
- **Fix:**
  - Memoize `argumentSlotsOf` per binding object.
  - Run the cheap shape filters (arity, labels, names) over all candidates before building any inference.
  - #3's witness table removes the witness half of it.

### 5. Lowering re-spells types for names: 6.7% of the form builder compile

- `names.spelledType` → `extern-key.keyTypeText` spells a whole type recursively for every instance frame (`instances` → `instanceName` → `entryHeader`) and every type-table entry. Nothing is memoized, and the form builder's types are deep structs.
- **Fix:** memoize `spelledType` per type key in `lowering/tables/names.ts`.

### 6. Type-match placement builds whole-tree parent maps: 3.9% plus 7.4% syntax in the std tests, 17% of the corpus, 9.7% of decimal16

- **Mechanism:** every written type resolved asks `matchPlaceOf` (via `inCasePattern`/`insideMatch`) and `structCaseOf`. Both climb `parentOf`, which builds a parent map of the whole module tree (`parentsIn` → `nodesUnder` → `fieldChildrenOf`).
- **Allocation:** in the corpus, about 20% of all allocation is these parent maps.
- **Fix:** P25's fix, now justified for cold compiles too. Resolution knows from where it descends whether it is in a `TypeCase` pattern or a `TypeMatch`, so pass that place down, or answer from the item (a type `match` stands only in top-level and trait items). Never build a tree-wide parent map. P28's `fieldChildrenOf` allocations shrink with it.

### 7. The `memo` helper's own cost: 9–11% self everywhere

- **Counts:** 852k calls per form builder check. `holdsRecursion` alone makes 434k memo lookups per check (3.8% self), `typeKey`'s per-object memo 3.3%, and `fieldChildrenOf`'s 1.9%.
- **Fix:**
  - P33 (one lookup instead of `has` then `get`).
  - For `holdsRecursion`, compute it once at construction as a field of the type (normalize at construction) instead of looking it up in a WeakMap per call.

### 8. Front end: 4% of the form builder, 12–15% of the std tests

- **Throughput:** warm scan runs at about 1,330 lines/ms; parse is 4× slower at about 316 lines/ms.
- **Parser cursor:** about 15 `#rawAt` and 7 `#breaksLine` calls per token (38.9M and 17M for 2.5M tokens in the corpus).
- **`bodiesHeldBy`:** one reflective walk per parse (P21), 0.8–4.9%.
- **Bind:** 1.5–4.5%.
- Low priority next to items 1–4.

### 9. GC: 4–7% of the cold compile, 8–18% of the warm and many-program runs

- About 1 GB is allocated per form builder check.
- **Top sources:**
  - canonical keying, about 25%;
  - witness overload choice, about 10% (`Set` < `Inference` < `takenBy`, plus `argumentsInapplicability`);
  - parent maps;
  - scanner tokens.
- It falls with items 1, 3, 4 and 6.

### Smaller

- **P24's content keys:** `checkKey`, with spelled keys of each noted check's arguments, is 2.9% of the form builder check and runs even in a cold check. Low priority.
- **`notesOfReads` (P30):** 1.1% of the form builder check.

## Outside the compiler, for the record

- **Eager imports:** the CLI imports about 880 modules for every command (190 ms), including the LSP stack, zod, the runtime, prettier and the formatter. `check` needs about 400 of them (110 ms).
  - A trivial `ista check` takes ~280 ms against node's own ~50 ms.
  - Lazy per-command imports would save about 80 ms per `check`.
  - Node's compile cache saves only 10–20 ms. Bundling the CLI entry (tsdown is already the build tool) would remove most of the per-module resolve/stat/open cost.
- **ICU at import:** `stdlib/strings/natives.ts` creates an `Intl.Segmenter` at import (~9 ms of ICU setup) for every command.

## Suggested order

1. Pre-key memo of canonical keys (#1).
2. P22's program-wide goal table plus the witness-choice table (#3).
3. `unionOf` memoized by member keys (#2).
4. `argumentSlotsOf` memo and the cheap candidate prefilter (#4).
5. `spelledType` memo (#5).
6. Pass the match place down (#6, P25).
7. P33 and the `holdsRecursion` flag (#7).

Items 1–3 together should take the form builder compile from about 1.7 s to well under 1 s.
