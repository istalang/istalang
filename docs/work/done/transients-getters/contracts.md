---
description: implementation contracts for proposal 13 — the `transient` IR instruction and its runtime lookup, how a getter read is recorded and flows to lowering, and which existing units each part reuses; read before implementing any phase of docs/work/done/transients-getters/plan.md
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [transient, getters, contracts, lowering, runtime]
---

# Proposal 13 — contracts

Semantics: `docs/proposals/13-transients-and-getters.md`. This file fixes what the phases must agree
on and what each reuses; everything else is the implementer's.

## Transient (partition T)

- **Syntax.** `transient` is a contextual word followed only by `let`, listed beside `hold` in
  `syntax/tokens/grammar-words.ts` (followers `transient: ['let']`) and parsed through the same
  `parseVariableAfter` path. The tree records it on `VariableDeclaration` as its own field, never
  by overloading `hold`. Recipe: `docs/reuse/syntax-and-trees.md`, contextual words.
- **Checker.** A transient is always a cell variable (the `inCell` set `noteCaptured` fills).
  Its initializer is checked in a scope without the function's parameters and locals, its type
  parameters kept. A transient anywhere but the top of a function body, before its other
  statements, is a compile error. The static-lifetimes analysis treats its value as given by code
  it can't see, as it treats a parameter's.
- **IR.** One instruction, `transient { dst: register, target: label }`, shaped as
  `contextConstant` is (`definition/instructions/data.ts`), registered in every per-kind table that
  instruction is. `dst` is the variable's cell register. The initializer and its write follow the
  instruction as any cell `let`'s do; nothing like `makeContextConstant` is added.
- **Runtime.** Every execution, an async call's or a synchronous marked call's alike, keeps the
  transient cells visible where it started, by function id: its caller execution's own, plus those
  the caller's frames hold. It is computed once, in `Instance.startExecution` (the one place an
  execution is born), persisted as one field of the `execution` heap object, which holds those
  cells (`docs/reuse/runtime-and-persistence.md`, persisted formats and heap objects); the root
  execution has none. The handler, reached as `currentCall` is (`SegmentRunner`), takes the cell
  of the nearest frame of its execution running the same function id with `dst` holding one, else
  its execution's kept cell for that function id. Found: put the cell handle in `dst`, jump to
  `target`. Not found: fall through. No table and no new heap object kind.
- **Lowering.** The writer emits the instruction where the flow declares a transient; release is the
  frame's own `return`, as for any register.

## Getters (partition G)

- **Syntax (G3, replacing G2's `@Getter`).** `get` is a contextual word after `fn`, a getter only
  when an identifier follows it; `FunctionDeclaration` records it in one field of its own, and
  "is a getter" reads that field. No annotation remains.
- **Declaration checks.** A `@Getter` function takes exactly `self`, by value, and is not async;
  `@Getter` anywhere but a function is the existing wrong-place annotation error.
- **Lookup.** The methods, getters and statics a name may mean on a type come from one enumeration
  in `checker/resolution/choosing/candidates.ts`, which `lookup/members.ts` calls (phase G1, DRY
  finding 3). Getters are split from methods there once; every consumer (member reads, method
  calls, completion, hover) dispatches on that split.
- **Reading.** `checkMemberAccess`, on finding no stored field, resolves the getter as the call
  `g(x)` through the existing call resolution (`resolveCall`), recorded at the `MemberAccess`. The
  record is a variant consumers dispatch on, never told from a function named as a value by the
  presence of a receiver. `fieldOf`/`fieldsOf` stay stored-fields-only, so literals, places,
  patterns, conformance, spreads and field loops are untouched.
- **Flow.** The flow builder emits a getter read as a `call` op with the receiver as argument 0,
  reusing the method-call path (`rules/flow/build/calls.ts`). Lowering, the data rule and
  lifetimes then see an ordinary call; none of them changes.
- **Trait fields (G3).** A required field is met by the type's readable member of that name and
  type, through the one conformance path (`fieldOf`, `resolution/conformance/`), extended rather
  than paralleled. What a required-field read in generic code or through `any` becomes is decided
  per instance, from the concrete member, when lowering closes it: a field read or the getter's
  call. The checker records the requirement, never a pre-chosen read.
- **Conflicts.** A use finding a field and a getter, or a getter and a method, of one name reports
  as `fieldOrMethod` (5505) does today, at the use.
- **Editor.** Completion lists getters as properties; hover, definition, references and rename
  reach the getter through the recorded call.
