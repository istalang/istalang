---
description: quality audit (2026-11-16) of src/compiler/lowering and src/definition against clean-dev, aimed at the IR-first rework — structure, roots and churn, violations by family, IR contract gaps (decisions left to runtimes, punning, untyped registers, what an LLVM backend lacks) and a Mikado-ordered refactor ranking; read before reshaping lowering, the Definition schema, or planning typed registers or lifetime instructions
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [audit, lowering, definition, ir, typed-registers, lifetimes, llvm, clean-dev]
---

# Lowering and Definition audit (read-only research)

Evidence snapshot: `main` at `dd0df1ba`. Lifetime rules themselves are in `lifetimes-inventory.md` and
`docs/work/ir-first/design.md` (decision 4); cited here, not redone. IDs (D1, P3…) are referenced by §4.

## 1. Map

| Folder | LOC (non-test) | Role |
|---|---|---|
| `lowering/` (root) | 298 | `lower.ts` entry (`lower`, `lowerTests`), `context.ts` (`FunctionContext`, `CodeContext`) |
| `lowering/tables/` | 1493 | `DefinitionTables` (worklist, interning), `TypeTable`, instances/keys/names, extern keys, constants |
| `lowering/flow/` | 1559 | `FlowWriter`: checker flow IR → instructions (operations, exits, places, parts, layout, variables) |
| `lowering/functions/` (+`fits/`) | 2084 | `FunctionLowering` (one code entry), frames, prologue, `CodeWriter`, counted inference, conversions |
| `lowering/values/` | 1141 | layouts: unions-as-enums, holdings, optionals, structs, variants, keyed fields |
| `lowering/synthesized/` (+`boundary/`) | 1362 | `SynthesizedCode`, trait-object dispatch, derived JSON codecs, host externs, start entries |
| `lowering/calls/` | 516 | `emit-call.ts` (only `call` writer), closed calls, waits, packs |
| `definition/` | 3626 | zod schema: instructions 584, tables 507, validation 695, values 1246, extern-key, traces, formats |

Tests: 4009 LOC across both. Lowering's only external importer is `compiler/compile.ts`.

**Flow.** `lower()` → `DefinitionTables` numbers entries by string key and queues them → `lowerReached`
drains the worklist → `pendingEntry` (15-arm `switch`: 12 `PendingEntry` + 3 `ClosingEntry` kinds) →
`entryOf` (6 own-entry kinds, `tables/own-entries.ts`) → `FunctionLowering.lower*` or a synthesized
builder → `CodeWriter.finish` (spans, `counted`) → `tables.finish`.

**Roots** (internal fan-in, approx.): `context.ts` 22, `tables/instances.ts` 13, `calls/emit-call.ts` 12,
`calls/closed-calls.ts` 12, `values/holdings.ts` 11, `values/unions.ts` 10, `functions/code-writer.ts` 10,
`tables/tables.ts` 9. Definition (importing files repo-wide): `values/values.ts` 92 (runtime/scheduler
29, lowering 7), `operands.ts` 82, `definition.ts` 33, `tables/functions.ts` 24, `tables/types.ts` 19.

**Churn** (commits since 2026-09-01, renames followed; repo began 2026-10-24): `functions/index.ts` 88,
`tables/instances.ts` 64, `tables/tables.ts` 53, `lower.ts` 51, `tables/names.ts` 50, `tables/type-table.ts`
48, `context.ts` 45, `calls/closed-calls.ts` 45, `synthesized/index.ts` 44, `functions/frames.ts` 40. Five
commits on 2026-11-16 alone patched register counting and field-loop registers (`5beb9531`, `43fdc5bf`,
`70d4e458`, `aa5f2ee6`, `dd0df1ba`).

**Dead code:** `knip` reports nothing; lowering emits every instruction kind in `definition/instructions/`.
Waste is structural (stored derived data, duplicate homes), not unused exports.

## 2. Violations by family

### Duplication and placement

- **D1. Two code-entry builders.** `FunctionLowering` (`functions/index.ts`) and `SynthesizedCode`
  (`synthesized/index.ts`) each keep a cell list (`VariableRegisters` vs their own) and each assemble the
  `CodeFunction` around `CodeWriter.finish({inputs, cells})`. `array`/`map` are written in three places
  (`SynthesizedCode.array/map`, `flow/operations.ts` `made`, `flow/places.ts` `appended`), although the
  synthesized banner claims "each instruction has one writer". Synthesized code types no register (all
  counted unless `holdsOnlyPlain()`, used by codecs only). Blast: every entry, and typed registers would
  be added twice. Fix: one entry builder (frame, registers, cells, finish) that both compose.
- **D2. Cells are created in four places:** `flow/variables.ts` (`cellRegister`, and `cellHolds` with
  `VariableRegisters.remakeCell`), `SynthesizedCode.inCell`, and the copy-in cells of `flow/places.ts`.
  Fix: one cell constructor on D1's builder.
- **D3. Entry identity is smeared.** Key strings are built in `tables/tables.ts` (`native:`, `constant:`,
  `start:`, `defaults:`, `dispatch:`, `convert:`, `field:`, …) and `tables/instances.ts` (`instanceKey`,
  `nestedKey`, `asyncFitKey`, `conversionKey`); names in parallel functions (`instanceName`, `nestedName`,
  …); headers in five `DefinitionTables` methods. `owner.kind === 'constant' || owner.kind ===
  'contextConstant'` repeats four times in `instances.ts`. A new entry kind edits the `PendingEntry`
  union, an `…Index` method, a key, a name, a header, the `pendingEntry` switch and a builder. Fix: a
  typed table `Record<EntryKind, {key, header, lower}>`, as AGENTS.md requires for an open set of handlers.
- **D4. A type is spelled four ways:** checker `typeKey` (identity), `tables/names.ts` `tableKey`
  (persisted labels, union variant order), the `KeyType` projection in `tables/extern-keys.ts`, and
  checker type text. The extern projection is "lossy on purpose … as keys did before those were types,
  so no key changes", a compatibility constraint frozen by `extern-keys.sweep.test.ts` and
  `tables/extern-keys.txt`. Greenfield fix: derive extern keys from one spelling and regenerate the file.
- **D5. Runtime value algebra lives in the contract folder.** `definition/values/` `json-values.ts`,
  `written-json.ts`, `equality.ts` (in-place map ops), `parts.ts`, `replacing.ts`, `instance-handles.ts`
  and `declared-values.ts` have no lowering importer (only runtime/, live/, stdlib/); lowering imports
  only `values.ts`. Fix: definition keeps the persisted `Value` schema, the rest moves to a runtime-shared
  folder.

### Responsibility

- **R1. `DefinitionTables`** (`tables/tables.ts`, 426 LOC, 53 commits) holds: the module table, constant
  interning, function numbering, the worklist, closing-entry staleness, starts, five header builders and
  13 `…Index` methods. Fix: an entry registry driven by D3's table, with interning kept apart.
- **R2. `tables/instances.ts`** (64 commits) mixes the `BodyOwner` model, `rootInstance`, the `AsyncFit` and
  `ConversionEntry` shapes, keys and names. These belong in D3's table rows.
- **R3. `FunctionLowering`** is the hottest file (88 commits): four factories, five `lower*` methods, and a
  mutable "reading" that `inFieldPasses`/`inDefaults` swap around callbacks.
- **R4. `FlowWriter`** (`flow/writer.ts`) contradicts its own banner ("the writer reads no checked body"):
  its type lookup reads `context.body.declaredTypeOf`, and `waypointAt` walks syntax ancestors and checker
  annotations. Its public mutable sets `keyed` and `maps` are written by `operations.ts` and read by
  `places.ts`. `maps` is derivable from the value's type, so it is stored derived data.

### Dependencies and seams

- **S1. Lowering reaches checker internals.** It imports 31 checker modules; about 113 of its 174 checker
  import lines go below `check.ts`/`surface/` into `types/*` (`parts/substitution`, `unions/*`,
  `identity/{identity,folding,unfolding-pairs,type-keys}`, `fitting/part-pairs`, `type/field-order`), legal
  only through the 43-module `checkerSurface` allow-list in `.dependency-cruiser.mjs`. Lowering re-derives
  layout from raw `Type` algebra (`changesLayout`, `holdingOf`, `laidOutAs`). Fix: one lowering-owned
  "concrete type → layout" module, so the allow-list shrinks.
- **S2. Lowering reads syntax** beyond spans: `functions/bodies.ts` (`writtenBodyOf`) and `waypointAt`.
  Fix: the flow carries each suspension's waypoint.

### Module shape

- **M1. Ambient dynamic scope.** `CodeWriter.withWaypoint` sets a hidden field that the `await`/`select`
  writers read; `FunctionLowering`'s reading swap does the same. Both are order-dependent hidden state.
  Fix: pass the waypoint and the reading explicitly.
- **M2. Ownership by allocation window.** `FlowWriter` makes every register allocated while writing an
  operation, and held by no value, that value's "extras", released with it. So any allocating helper makes
  a lifetime decision silently. Example: `made()` (`operations.ts`) allocates `dst` before its `switch`,
  and five of its eight arms return another register, so `dst` is wasted and released as an extra. Fix:
  helpers return what they own. Lowering-placed lifetimes need this first.
- **M3. Counted inference accretes edge cases** (about 230 LOC): `functions/plain-registers.ts` (127 LOC, a
  per-instruction write table, the third per-kind table beside `operandsOf` and
  `validation/instruction-rules.ts`); `CodeWriter`'s plain-register state and
  `holdsPlain`/`holdsCounted`/`holdsOnlyPlain` (one TSDoc sits above the wrong method); `flow/variables.ts`
  `holdsType`/`cellHolds`/`remakeCell`; `holdsOnlyPlain()` in `boundary/codecs.ts`. The five 2026-11-16
  commits patched it. It is a mini type inference over the untyped IR: the "second type system"
  `docs/arch/definition.md` cites as its reason to reject a typed IR.
- **M4. Start entries recompile bodies.** `lowerStart` lowers a function's body again with JSON arguments,
  and `startHeader?` is threaded through `instanceLowering`, `nestedLowering`, `instanceFrame` and
  `nestedFrame`, all so that a start is one frame in traces. Traces already hide handover and extern
  frames (`7dc942dc`). Fix: a synthesized wrapper (decode, call the entry, return), hidden likewise.
- **M5. Closing entries are relowered when stale.** `any` enums grow while lowering proceeds, so every
  dispatch, `anyConversion` and `anyField` entry is written again on each growth (`nextPending` with a
  stored per-entry variant count). Fix: number `any` members to a fixpoint first, then write each once.

### Waste

- **W1. `counted` per register** (`definition/tables/functions.ts`) is stored derived data. The interpreter
  ignores it and counts every register, while compiled JS honors it (`codegen/entry-scope.ts`): two
  standards for one fact.
- **W2. Hand-invalidated caches keyed by mutable values.** `runtime/lifetimes/in-place.ts` must clear three
  caches after every in-place write: the `values/values.ts` summaries (`forgetSummary`), `forgetPlainOf` in
  `json-values.ts`, and `WrittenJson.forget`. clean-dev forbids hand-managed invalidation. Fix: give a
  value a new identity or version when it changes in place.
- **W3. Stale and sentinel.** Two contract comments say struct fields are in declaration order: the `struct`
  instruction (`instructions/data.ts`) and the struct `Value` (`values/values.ts`). The layout is name
  order (`values/struct-values.ts`, `values/struct-layout.test.ts`). The `definition.ts` version comment
  narrates history. `FlowWriter.write` ends unreachable code with a `return` of a freshly allocated,
  never-written register, because `return.value` is required.

## 3. IR contract quality

### 3.1 Decisions the Definition leaves to runtimes

| Decision | Made where today | Lowering could emit |
|---|---|---|
| Whether a register holds a value, a cell or a reference | `runtime/interpreter/registers.ts` `readRegister`/`writeRegister`: a `cells` lookup (`some`/`find`) on every access, plus a test of the contents; the first write makes the cell, which `transient` relies on | explicit cell and reference instructions (P1) |
| Release-all at `return`, reverse creation order | `instructions/control.ts` banner | let-go instructions (ir-first design decision 4) |
| In place vs copy for `store`, `behind` writes and collection natives | `runtime/lifetimes/in-place.ts` | "in place if unique" (ir-first design decision 4) |
| Letting go of `select` losers' `holds`, and of what a stopped call holds | runtime | written landings (ir-first design decision 4) |
| Which registers are counted | interpreter all, JS `counted` | reach facts on register types |
| `==` and map keys | `definition/values/equality.ts`, a structural walk over self-describing values | per-type equality and hash entries, as codecs are per type |
| Natives building results by name at run time | `declared-values.ts` (`variantOf`, `okOf`, `errOf`) for natives and the scheduler; json natives find `Json` by role (`jsonTypeOf`) and read extern `typeArguments`, as testing natives do | ista or lowering-built wrappers; natives take and give primitives |

### 3.2 Punning and premature layout

- **P1. A register's meaning hangs on the `cells` list and on run-time contents.** One `move`, read or
  write means "value", "through a cell" or "through a reference". This breaks AGENTS.md "one
  representation per meaning".
- **P2. `field` has three meanings:** a tuple element, a struct field, or a field of the *current* variant
  of an enum value. The last needs a run-time tag check and a layout lookup.
- **P3. `keep.into` is a hidden `Array` of holders of different types:** an array used as a holder list,
  which no element type can describe.
- **P4. Flags instead of variants:** an extern entry's `constant: boolean` with an optional `declaredType`;
  extern disposal's optional `function.host`; the Definition's flavors as optional
  `main`/`tests`/`jobServer` fields.
- **P5. Reach is stated twice, and partially:** in the per-register `counted` list, and as
  `counted: boolean` on extern type entries only. Struct, enum and alias entries can't state it.
- **Sound:** indexes and variant/field positions are lowering's semantic decisions, and spans are debug
  info.

### 3.3 Untyped registers: what typing them takes

- **Allocation.** `CodeWriter.allocate()` is untyped: 46 call sites in 21 files, plus 2 `allocating()`
  windows (M2). Most sites have the type in hand: `FlowWriter.typeOf` types every flow value (`2b81dee1`),
  and the value helpers pass `TypedValue {register, type}` (`values/holdings.ts`). Synthesized code types
  nothing, so D1 comes first.
- **Missing `TypeReference` kinds.** It has primitive, named, tuple and function; it lacks references (`&`
  parameters, `behind` dst), waits (`wait` dst; the prelude has no `Wait` type), hold lists (P3) and
  `currentCall`'s weak handle. Cells are typed already (`cells[].type`, a `_Cell<T>` entry).
- **Field loops.** Blocks are already written once per pass (`flow/layout.ts`). A variable, though, is one
  register per declaring name across passes (`VariableRegisters`): its type is read per pass, and
  `remakeCell` overwrites its cell type with whichever pass reaches a disposable. Fix: key the register
  by name plus pass path (`BodyOwner.passes` identifies the pass), one register per pass. No union type is
  needed, since passes are disjoint code.
- **Stale plan.** `docs/work/linker/native-binary.md` cites "60 call sites in 31 files" and the paths
  `lowering/code-writer.ts` and `function-lowering/frames.ts`; both counts and paths are stale.

### 3.4 What an LLVM backend would lack beyond 3.1–3.3

Self-describing values (tags; `Int` a bigint) that `==`, map keys, `field` and `switch` read, so every value
is boxed without typed registers; no last-use marks (`return`/`release` rely on enumerating registers);
natives bound by string key that reflect on types at run time; and `definition/validation/` checks
indexes, shapes, arity, prologue and waits but neither types nor ownership.

## 4. Ranked refactors (Mikado order)

Goal: every register typed, every type entry states its reach, lifetimes are instructions, and no runtime
makes a policy decision. Prerequisites come first; ∥ marks items independent of the rest.

0. **∥ Quick deletes.** W3, the misplaced TSDoc and the version history. D4: drop the compatibility
   projection and regenerate `extern-keys.txt`.
1. **Unify the entry builders (D1, D2).** Needed to type every register once, and for lifetimes in
   synthesized code.
2. **∥ Entry-kind table, and split `DefinitionTables` (D3, R1, R2, with M4 wrappers and M5 two-phase
   closing).** These are the three hottest tables files; afterwards a new entry kind is one table row.
3. **Explicit ownership in `FlowWriter` (M2), and no ambient state (M1, R4 `maps`).** Needed before
   lowering places a let-go per owned register.
4. **Cell and reference instructions (P1), and `field` split by tuple, struct and variant (P2).** Touches
   both runtimes' register access (`interpreter/registers.ts`, `codegen/entry-scope.ts`). Needed for typed
   registers and for LLVM.
5. **Typed registers.** `allocate(type)`, the new `TypeReference` kinds, per-pass field-loop registers,
   typed hold lists or explicit let-go in place of `keep` (P3), and entry signatures. Needs 1 and 4.
6. **Reach facts on every type entry (P5).** Then delete `counted` (W1), `plain-registers.ts`, the
   `CodeWriter` plain state, `holdsType`/`cellHolds`/`remakeCell` (M3) and extern `counted`. The biggest
   deletion: about 230 LOC in lowering, a schema field, and codegen's counted branches. Needs 5.
7. **Lifetime instructions** per `docs/work/ir-first/design.md` (decision 4), with an ownership verifier in
   `definition/validation/`. Needs 3, 5 and 6.
8. **∥ Move the runtime value algebra out of `definition/` (D5, W2),** before a second runtime is written
   against the contract.
9. **Natives by name become wrappers, and extern `typeArguments` go (3.1).** Needs 5.
10. **∥ Shrink the checker surface (S1, S2)** behind one layout module, once step 5 fixes the type facts
    lowering needs.

**Spec simplification candidates**
- **(a) Derived JSON codecs in ista.** This needs field loops to expose field annotations (`@JsonName`,
  `@JsonSkip`) and enums to get a variant loop. Spec §3.16 says field loops reach "only a struct's fields".
  It would delete `synthesized/boundary/{encoder,decoder,codecs}.ts` (427 LOC) and the `derivedCodec`
  own-entry kind; `json.ista` already holds every hand-written codec.
- **(b) Allow a start's wrapper frame in traces, or hide it.** Then M4 needs no body recompilation.
