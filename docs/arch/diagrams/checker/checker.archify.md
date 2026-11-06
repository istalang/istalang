# How does the Istalang type checker work? {#istalang-checker}

The checker is a **lazy, incremental query engine** over one immutable Program. `checkProgram` makes one `ProgramChecker` per Program, every answer is an entry that records what it read, and each body is checked once by a `BodyChecker` that records what lowering needs.

- Two contexts split the work: `CheckerContext` answers program-wide questions, `BodyContext` checks one body. Construct modules see only these interfaces.[](source:context)
- Checking is bidirectional: each handler gets the expected type, and every mismatch goes through `fit`, which also records the implicit conversion.[](source:bodychecker)
- Every call is applied in one place, `applyCall`: choose with inference, instantiate with witnesses, then fit the arguments.[](source:applied)
- An entry logs its reads. A checker built after an edit replays them and takes the entry over when every read answers alike.[](source:entries)

@answer scope="src/compiler/checker and structures/entries · worktree p4-computed at 5403091 · 2026-11-05"
@meta locale=en
@source check title="checkProgram and the Checker surface" path=src/compiler/checker/check.ts lines=293:400
@source context title="CheckerContext and ProgramInputs" path=src/compiler/checker/context.ts lines=77:171
@source programchecker title="ProgramChecker wiring" path=src/compiler/checker/program/program-checker.ts lines=113:231
@source bodychecker title="BodyChecker: expression, fit, record" path=src/compiler/checker/body/body-checker.ts lines=91:296
@source functions title="FunctionChecks: results and bodies as entries" path=src/compiler/checker/declarations/functions.ts lines=44:111
@source modulechecks title="ModuleChecks: module and item entries" path=src/compiler/checker/declarations/module-checks.ts lines=29:98
@source handlers title="Expression handler table" path=src/compiler/checker/expressions/expressions.ts lines=88:127
@source calls title="checkCall: callee kinds" path=src/compiler/checker/expressions/calls.ts lines=63:101
@source resolve title="resolveCall" path=src/compiler/checker/calls/resolve.ts lines=85:125
@source applied title="applyCall" path=src/compiler/checker/resolution/applied-call.ts lines=59:108
@source entries title="Entries: get, produce, takeOver, replay" path=src/structures/entries/index.ts lines=163:309
@source cruiser title="Checker inner layers" path=.dependency-cruiser.mjs lines=116:166
@source passes title="Passes of a field loop" path=src/compiler/checker/passes.ts lines=1:20

## How is the checker composed? {#composition}

@diagram architecture id=checker-map source=checker-map.architecture.json title="Checker units and who calls whom"

@steps id=composition-steps
| cs-surface | check.ts | `checkProgram(program, { previous })` memoizes one `ProgramChecker` per Program in a `WeakMap`. Later phases import only this surface and the models it names. | checker-map | check |
| cs-program | ProgramChecker | Implements `CheckerContext`. It composes units (functions, constants, layouts, parameters, aliases, statics, type parameters, module checks, annotations, JSON forms, lookup), each keeping its answers in entry tables. | checker-map | progchk |
| cs-inputs | program-inputs | Checking reads the Program and Bindings only through recorded inputs: a module's items, its imports, a function's body, a role. An entry then depends only on the parts it read. | checker-map | inputs |
| cs-decls | declarations/ | One handler per declaration kind resolves signatures, layouts and annotations, then asks for each function's body. | checker-map | decls |
| cs-body | BodyChecker | Implements `BodyContext`. Per-concern units (variables, functions, implicit calls, patterns, chains, field reads) record facts per pass; the class only composes them. | checker-map | bodychk |
| cs-handlers | handler tables | `handlerOf(table, node)` dispatches on the node's kind. Handlers reach each other only through the context. | checker-map | handlers |
| cs-lookup | lookup/ | Tool queries decide nothing: they check the holding item on demand, then read what checking recorded. | checker-map | lookup |

The checker's folders are layers too. Each folder imports only the folders listed before it, so engines never import constructs.[](source:cruiser)

| Order | Folder | Owns |
| --- | --- | --- |
| 1 | `diagnostics/` | The checker's diagnostic catalog |
| 2 | `types/` | The `Type` model, identity by key, fit, substitution, unions, written types resolved |
| 3 | `inference/` | Type arguments matched from what a call or literal gives |
| 4 | `traits/` | Constraints, `any` types, object safety, struct constraints, `Sendable` |
| 5 | `resolution/` | Candidates and ADL, choice, conformance and witnesses, implicit calls |
| 6 | `calls/` | A call in a body: arguments checked, places it changes, operators |
| 7 | `patterns/` | One walk for every pattern, tests in run order, exhaustiveness |
| 8 | `flow/` | Forward data flow: one table of how each construct runs |
| 9 | `rules/` | Agreement, `drop`, disposal, JSON codecs, expansion, annotations |
| 10 | `declarations/` | Signatures, layouts, module and item checks |
| 11 | `closures/` | Lambdas, local functions, captures, own calls |
| 12 | `expressions/` | One handler per expression kind |
| 13 | `statements/` | One handler per statement kind, blocks |
| 14 | `lookup/` | What tools ask by position |

## What happens when a module's diagnostics are asked for? {#lazy-check}

@sequence id=check-flow title="diagnose: from one module to one call"
| actor coord | compile.ts | frontend |
| actor pc | ProgramChecker | backend |
| actor ent | Entries | database |
| actor decl | declarations/ | backend |
| actor body | BodyChecker | backend |
| actor table | handler tables | backend |
| actor res | resolution/ | backend |
| phase | Ask for one module |
| coord | pc | diagnosticsOf(module) |
| pc | ent | get module check |
| ent | decl | compute: checkItem per item |
| decl | ent | get body of fn |
| ent | pc | compute: #checkBody |
| pc | body | checkFunction(body, params) |
| phase | Check one body |
| body | table | handlerOf(node)(ctx, node, expected) |
| table | res | resolveCall, applyCall |
| res | ent | get callee result, constraints |
| ent | res | answer or stand-in | return |
| res | table | chosen call, result type | return |
| table | body | type, recordCall, fit | return |
| body | ent | report: note on entry |
| body | pc | CheckedBody | return |
| phase | Collect |
| ent | pc | notes of every read entry | return |
| pc | coord | sorted diagnostics | return |

@steps id=check-steps
| ck-ask | diagnosticsOf | `compile.ts` asks per module and skips std modules; they are checked by their own tests, and lowering still checks what a program uses of them. | check-flow | coord |
| ck-entry | module check | `ModuleChecks` asks one entry per module, which asks one entry per item, then clashes, expansion and one entry per constraint check noted for the module, keyed by what it checks, so an edit elsewhere takes the check over.[](source:modulechecks) | check-flow | ent |
| ck-body | bodies | A body is an entry of `FunctionChecks`. A function without a declared result reaches its body through `resultOf`, so a recursion cycle meets the result first.[](source:functions) | check-flow | decl |
| ck-handler | handlerOf | `expression(node, given)` stores the expected type, dispatches through `expressionHandlers`, and records the node's type in the current pass.[](source:handlers) | check-flow | body |
| ck-call | applyCall | Candidates are chosen, instantiated and fitted in one place; asking for another function's result is just another entry read.[](source:applied) | check-flow | res |
| ck-collect | notes | Diagnostics are notes on entries. A module's diagnostics are the notes of everything its check read, sorted by position, code and message. | check-flow | pc |

## How is a call resolved? {#call-resolution}

| Stage | Module | What it decides |
| --- | --- | --- |
| Callee | `expressions/calls.ts` `checkCall` | Name, method on a receiver, static on a type, conversion `T(x)`, or a function value.[](source:calls) |
| Candidates | `resolution/candidates.ts` | The binder's overload set with the prelude's, ADL on argument types, requirements of type-parameter constraints, traits a union meets |
| Choice | `resolution/choice.ts`, `applicability.ts` | Each candidate binds the arguments and infers type parameters; concrete beats generic, no-rest beats rest, no conversion beats conversion; any other tie is ambiguous |
| Instantiation | `resolution/conformance.ts` | Open parameters come from the expected type, then defaults; each constraint is met by a coherent witness |
| Fit | `resolution/argument-fit.ts` | Each argument is fitted to its parameter type, and its implicit conversion is recorded |
| Record | `calls/resolve.ts` `recordChosen` | The `ResolvedCall` (function or requirement, type arguments, witnesses, binding, receiver) goes into the body's `resolved` table.[](source:resolve) |

@callout level=note title="Calls are chosen from the arguments alone"
The result type never picks an overload. The expected type only fills type parameters the arguments left open, so an explanation of a failed call never disagrees with the choice.

## How do syntax, entities, types and checked records relate? {#model}

@diagram class id=checker-model source=model.class.json title="Syntax, entities, types and checked records"

- Nodes hold no tokens and no resolved references. The binder and checker keep those in side tables keyed by node.
- An entity is made once per declaring node, so an edit that keeps a segment keeps its entities, and every type naming them.
- A nominal type is its declaration's entity plus type arguments; field types are derived by substitution, never stored per instantiation.
- A generic body is checked once. Lowering reads it through a substitution per instance (`body/facts/instantiation.ts`).

| `CheckedBody` record | Lowering uses it to |
| --- | --- |
| `typeOf`, `expectedOf` | Lay out registers and values without recomputing a type |
| `resolved`, `implicitCallOf`, `madeCalls` | Close each call into a function-table entry or a dispatch |
| `fitAt` | Convert a value once, after computing it |
| `patternOf`, `targetsOf`, `assignedOf` | Emit tests in run order, then bindings along part paths |
| `inCell`, `functionOf` | Give captured or `&`-passed variables a cell, and build closures |
| `passesOf` | Emit one copy of a field loop's body per field, from that pass's records[](source:passes) |

## How does an answer survive an edit? {#incremental}

@diagram lifecycle id=entry-life source=entry.lifecycle.json title="One entry across two checker revisions"

- A table names one kind of result: `results`, `bodies`, `module checks`, `item checks`, `resolved types`, `disposals` and more.
- When a non-tentative checker is made from the previous one, it releases the revision before that, so at most two revisions are held.
- A tentative checker, such as completion's placeholder parse, takes over without releasing anything.
- Replay stops at the first read that answers differently, so the work it did is reused by the recompute.[](source:entries)

## Which handler tables does the checker register? {#tables}

| Table | Signature | Gives |
| --- | --- | --- |
| `expressionHandlers` | `Handlers<BodyContext, Expression, [expected], Type>` | The node's type |
| `acceptsHandlers` | `Handlers<BodyContext, Expression, [], Accepts>` | The parameter types an argument without its own type can take |
| `knownTypeHandlers` | `Handlers<BodyContext, Expression, [], Type>` | A part's own type, without checking or reporting |
| `buildsHandlers` | `Handlers<BodyContext, Expression, [], Accepts>` | The types a struct, tuple, array or map literal can be built as |
| `statementHandlers` | `Handlers<BodyContext, Statement, [expected], Type>` | The statement's type: value, `Never` or `Unit` |
| `declarationHandlers` | `Handlers<CheckerContext, Declaration, [ModuleId], void>` | Nothing; it resolves and checks a top-level item |
| `typeHandlers` | `Handlers<Resolution, TypeNode, [], Type>` | The type a written type denotes |
| `constructs` (flow) | `Handlers<FlowWalk, Construct, [Opaque], Flow>` | How each construct runs, for forward data flow |

Each table is exhaustive by type: a new node kind fails to compile until every table handles it.
