---
description: the constraint scope I2's joint solving is redesigned around — where a scope opens and settles, which expressions join it, joined and postponed members, variables, choosing, settling order, records and diagnostics at settle, and what it deletes; read before implementing or examining I2 (J1, J2) or changing how inference spans nested expressions
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-09
tags: [design, checker, inference, i2]
---

# Joint solving: one constraint scope

Replaces I2's first build (`resolution/applying/joint.ts`: `OpenInference`, `JoinPlace`, the
`joining` closures), whose review found three root causes: joining was opt-in at four node kinds
and settled only on the success path (orphaned children); two models of deferral (`Accepts` and
joining); and per-declaration views of a shared system. Design §4's rules are unchanged; this is
where they live.

## 1. Scope

- `BodyContext` holds the current **constraint scope**: one system of variables (today's
  `CallSystem`), its members, and what waits for its settle.
- `expression(node, expected)` checks a node of a **joining kind** (§2) in the current scope,
  opening one when none is open. Any other kind is a **boundary**: it suspends the scope while its
  parts are checked, so each part opens and settles its own, and its own type then joins as given.
- `settled(node, expected?)` reads a part settled the same way, as a joining kind's parts in §2's
  second column are. A statement suspends the scope too, except a value block's tail, and a
  `return`, which checks its value in the scope its function's result lives in, however deep in
  statements it sits.
- A scope settles when the call that opened it returns, on every path, a throw included. Nothing
  else settles it, so no member is ever orphaned.
- The scope's interface on `BodyContext` (`contexts/scopes.ts`) is the body's contract: it names
  `types/` and `types/inference/`, and the type model and inference never import it. The scopes
  themselves are `wiring/body/`.

## 2. Joining kinds

The table below is `wiring/body/scope-protocol.ts`, one entry per kind of expression. A field
loop's passes each settle before the pass exits: every pass is a boundary
(`BodyChecker.fieldPasses`).

| Joins | Its parts read settled |
|---|---|
| Calls: function, method, static, variant, value call | callee value, receiver |
| `T{…}`, `new T{…}`, `struct{…}`; array, map, tuple literals (empty ones too) | — |
| Scalar literals, a negated numeric one included (fresh), `none` | — |
| A name standing for functions or a variant; a qualified fieldless variant | — |
| Parenthesized, indented value | — |
| `if`, `match`, `select`, block: their values | condition, scrutinee, statements |
| Lambda: its tail and its `return`s while its result is open | its statements |

Operators stay boundaries, as today.

## 3. Members

- **Joined:** checked now; its type may mention the scope's variables.
- **Postponed:** an expression that needs its expected type (a lambda whose result or a
  parameter isn't written, a function or variant named as a value, a bare variant call, an
  indented value naming no type) is a **placeholder variable**. Its expected type is what the
  scope knows of the placeholder: its upper bound, else what the variables it is related to tell
  so far (`Small` in `[Size.Large, Small]`). A lambda's written parameters bound its placeholder
  from the start. It carries:
  - `accepts`, consulted whenever its placeholder gains a bound, so a candidate probe that gives
    it one it can't be fails (arity, a variant of another enum);
  - what it waits on: the expected type's inputs settled (lambda, function value), or its head
    known (variant, indented value).
- **`struct{…}`** is joined: its fields are checked in the scope, and its type is a placeholder
  whose lower bound is its shape, marked as one, so probes see its fields' types. Whether it builds
  a struct or stays a shape is decided at settle (design §4).
- A composite holding a postponed item (`(1, fn x: x)`, `[fn x: x]`, `if c: Good(1) else: …`)
  is joined; its item's bound comes from decomposing the composite's, so no walk finds it.
- Parts that must agree (branches, a function's tail and `return`s, collection items) bound a
  **result variable** from below, and the expected type bounds it from above. Agreeing is settling
  it (rule 3, `commonType`); their fits, and `?`'s propagation into an open result, are its
  completion (B38).
- One **judging loop**, the scope's, checks postponed members as they become ready, ready ones
  first, then in order; one never ready is checked with what is known. A judged member's type
  bounds its placeholder.

## 4. Variables

- The scope mints a construct's variables per construct instance. A construct speaks in its
  **open signature** (its parameters replaced by its variables); only the scope reads a variable as
  its parameter (constraints, member unions, defaults, settling).
- Nothing translates between one declaration's parameters and another construct's variables.
  `types/inference/` stays free of the body, for its other users (constraint search, silent
  choice).

## 5. Choosing

- Candidates probe as **trials** on the scope's system: a failed probe leaves no bound, variable or
  member behind. The chosen candidate's constraints and completion are committed.
- The expected type advises every generic construct through `expect`, struct literals included.
  Written type arguments stay given.

## 6. Settling

- Bounds propagate across related variables as they are added, equalities included (an equality
  reaches a related variable as both its bounds), so a placeholder under an invariant parameter
  (`Item{value: Small}`) gets its bound.
- Once every postponed member is judged, all variables settle together by design §4's policy, in
  dependency order: a variable bounded by another settles after it; related variables in a cycle
  settle as one.

## 7. Records and diagnostics

- Written only at settle: each node's solved type, then each construct's **completion**
  (instantiation, witnesses, fits and wraps, default calls, literal fields, chosen call, keys, a
  lambda's function type). A fresh literal is recorded as its literal type where its settled
  expected type holds one, else its base.
- A diagnostic naming a type is raised at settle, with every type solved. No record and no
  diagnostic ever shows a variable.
- A construct that fails (no candidate, ambiguous, cannot infer) still completes with error
  records, and its written arguments still record their parameter's type for completion. Its
  members complete on their own bounds; a variable only the failure left unbounded settles to the
  error type without 5100.

## 8. Deletes

`joint.ts`; `checkJoining`, `mayJoin` and the `joining` closures; `Accepts`, `AcceptedPart`,
`acceptsHandlers`, `argumentPart`, `checkItemsAhead`, `#checkedAhead`; `checkDecidedFunctions`,
`inferNestedFunctions`, `judgePostponed`, `settleJoinedLambdas`, `joinedGuide`, the lambda guide
modes; `knownArguments`' expected path; `written-expectations.ts`'s second choosing pipeline;
`Inference.within` and twin translation.
