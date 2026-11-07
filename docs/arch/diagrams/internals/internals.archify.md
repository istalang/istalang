# How do the binder and checker store and share what a name means? {#name-internals}

They meet on **node identity**. The binder memoizes one `VariableEntity` per declaring `Identifier` and maps every name to an entity. The checker keys a variable's type and facts by that same declaring `Identifier`, and lowering later keys its register by it too.

- Binding has two lifetimes: `bindModule(tree)` builds `Map<Identifier, LocalEntity>` once per tree; `link(program)` resolves free names and imports once per Program.[](source:bindmodule)
- Entities are made only in local binding, through `WeakMap`s keyed by syntax nodes, so an edit that keeps a segment keeps every entity in it.[](source:entities)
- A body's records are `PassTable`s keyed by node and kept per field-loop pass; a read walks from a pass to the passes around it.[](source:passes)
- Every `Bindings` answer the checker reads is recorded as an entry input, so incremental reuse also tracks what the binder said.[](source:inputs)

@answer scope="Binder, checker body storage, and their readers · worktree p4-computed at 5403091 · 2026-11-05"
@meta locale=en
@source entities title="Entity kinds and their memo maps" path=src/compiler/binder/entities.ts lines=60:236
@source localbinder title="LocalBinder: use, declare, record" path=src/compiler/binder/module/local-binder.ts lines=146:272
@source scope title="Scope: define, lookup, misses" path=src/compiler/binder/module/scope.ts lines=67:161
@source bindmodule title="bindModule: memo on the tree" path=src/compiler/binder/module/bind-module.ts lines=38:54
@source statements title="Block pre-pass and variable declarations" path=src/compiler/binder/constructs/statements.ts lines=89:143
@source patterns title="Pattern bindings and or-pattern adoption" path=src/compiler/binder/constructs/patterns.ts lines=113:179
@source linker title="Linker: two passes, entityOf" path=src/compiler/binder/link/index.ts lines=65:245
@source links title="ModuleLinks and resolvedImport" path=src/compiler/binder/link/module-links.ts lines=15:33
@source inputs title="recordedBindings: each answer an entry input" path=src/compiler/checker/wiring/program/program-inputs.ts lines=67:95
@source variables title="VariableScope and checkVariableDeclaration" path=src/compiler/checker/constructs/statements/variables.ts lines=36:149
@source names title="checkName, variableType, declaredOutsideBodies" path=src/compiler/checker/constructs/expressions/access/names.ts lines=24:98
@source functions title="FunctionScopes.noteUse: captures" path=src/compiler/checker/constructs/closures/functions.ts lines=30:103
@source passes title="Passes and PassTable" path=src/compiler/checker/contexts/passes.ts lines=27:198
@source targets title="declareTargets" path=src/compiler/checker/constructs/patterns/targets.ts lines=15:26
@source bodychecker title="BodyChecker tables and #checkedAt" path=src/compiler/checker/wiring/body/body-checker.ts lines=91:400
@source lowervars title="Lowering: registers by declaring Identifier" path=src/compiler/lowering/constructs/statements/variables.ts lines=161:206
@source lowernames title="Lowering: a name read" path=src/compiler/lowering/constructs/expressions/access/names.ts lines=31:58
@source passbody title="Lowering: reading a field pass's body" path=src/compiler/lowering/functions/frames.ts lines=97:116
@source denotations title="Hover: a variable's declared type" path=src/compiler/checker/lookup/denotations/named.ts lines=97:117

## What does the binder store, and keyed by what? {#binder-storage}

@diagram class id=binder-internals source=binder.class.json title="Binder internals: what it stores, keyed by which node"

@steps id=binder-steps
| bs-block | Scope | `bindBlock` makes a block scope and first calls `expect(name)` for every name its statements declare, so an early use is reported as "used before declaration", not "undeclared".[](source:statements) | binder-internals | scope |
| bs-declare | VariableEntity | `declareVariable(scope, name, owner)` calls `variableEntity(name, owner)`, memoized on the declaring `Identifier`, then `scope.define(text, entity)` and `entities.set(name, entity)`.[](source:localbinder) | binder-internals | varEntity |
| bs-use | LocalBinder | `use(name, scope, role)` looks the text up through `#parent` scopes. A hit records `entities.set(useIdentifier, entity)`; a miss goes to `free` with its role and the scope's miss reason. | binder-internals | localBinder |
| bs-or | ModuleBindings | In `A \| B`, each alternative binds into its own nested scope; a later alternative's name is recorded as the first alternative's entity, so the body reads one variable.[](source:patterns) | binder-internals | moduleBindings |
| bs-link | ModuleLinks | `Linker` indexes owners, then links every module's imports and prelude, then every free name and qualified path. It makes no entities except empty function sets left to ADL.[](source:linker) | binder-internals | moduleLinks |
| bs-query | Bindings | `entityOf(module, name)` answers `undefined` if refused, else `resolved.get(name)`, else the local entity with an import placeholder replaced by its target.[](source:links) | binder-internals | bindings |

| Entity | Fields | Memoized by |
| --- | --- | --- |
| `VariableEntity` | `name: Identifier`, `owner: VariableOwner` | the declaring `Identifier` |
| `FunctionsEntity` | `name`, `overloads: FunctionDeclaration[]` | the overload list (`SequenceMemo`) |
| `TypeEntity` | `declaration` (struct, enum, trait, alias, type parameter, associated type) | the declaration node |
| `VariantEntity` | `enum`, `variant` | the `Variant` node |
| `VariantsEntity` | `name`, a bare name the expected type picks among | name, per module's items |
| `NamespaceEntity` | `declaration: NamespaceImport` | the import node |
| `SelfEntity`, `PrimitiveEntity` | `trait`; `name` | the trait; shared universe |

A `VariableOwner` is one of 14 node kinds: `VariableDeclaration`, `Parameter`, `For`, `FieldHeader`, `Comprehension`, `SelectCase`, the four binding patterns, `ExternConstantDeclaration`, `FunctionDeclaration` and `Lambda` (local functions), and an async function's `OwnCall`. The checker reads mutability and the type's origin from it.

## Where does the checker keep a variable's type and facts? {#body-storage}

@diagram class id=checker-storage source=checker-storage.class.json title="Checker body storage: where types and variable facts live"

| Store | Key | Value | Written by | Read by |
| --- | --- | --- | --- | --- |
| binder `variables` WeakMap | declaring `Identifier` | `VariableEntity` | `declareVariable` | every `entityOf` answer |
| `VariableScope.#types` | declaring `Identifier`, per pass | `Type` | `declareTargets`, `declareParameter` | `typeOf(entity)`, `declaredTypeOf`, hover |
| `VariableScope.#changed` | declaring `Identifier` | in set | assignments, `&` places | unused-`let` warning |
| `VariableScope.#inCell` | declaring `Identifier` | in set | `noteReferenced`, `noteCaptured` | lowering: cell register |
| `VariableScope.#references` | declaring `Identifier` | in set | `&` parameters | capture check, `isChangeable` |
| `VariableScope.#targets` | `TargetOwner` node, per pass | `TargetBinding[]` with `path` | `declareTargets` | lowering `bindTargets` |
| `BodyChecker.#types` | every `Expression`, per pass | `Type` | `#record` after each handler | lowering `typeOf`, hover |
| `BodyChecker.#fits` | `ValueSite`, per pass | `Fit` (conversion, union member) | `fit` | lowering `fitted` |
| `BodyChecker.#resolved` | `ResolvedSite`, per pass | `ResolvedCall` | `recordCall` | lowering `closeCall`, signature help |
| `FunctionScope.#captures` | declaring `Identifier` | `VariableEntity` | `noteUse` | `CheckedFunction.captures` |
| lowering `Variables.#registers` | declaring `Identifier` | `Register` | `declareVariable` | `lowerName` via `registerOf(entity.name)` |

A variable read gets its type in this order: an extern constant's written type, a top-level constant's checked type, a local function's type, else `VariableScope.#types` at the current pass.[](source:names)

## One variable, from `let` to register {#variable-life}

The example is `let total = price * qty`, later read inside a lambda: `fn(): log(total)`.

@sequence id=variable-flow title="let total: bound, linked, checked, captured, lowered"
| actor lb | LocalBinder | backend |
| actor scope | Scope | backend |
| actor link | Linker | backend |
| actor body | BodyChecker | backend |
| actor vars | VariableScope | database |
| actor fns | FunctionScopes | backend |
| actor low | lowering | backend |
| phase | Bind the module, memoized on its tree |
| lb | scope | expect("total") before the block runs |
| lb | scope | lookup price, qty: record each use |
| lb | scope | define total = variableEntity(decl name) |
| lb | scope | in the lambda: lookup total |
| scope | lb | same VariableEntity: record use name | return |
| phase | Link, memoized on the Program |
| link | lb | read entities, free names, paths |
| phase | Check the body |
| body | vars | declare(decl name, widened Int) |
| body | vars | recordTargets(decl, name, type, path) |
| body | link | entityOf(module, use name) |
| link | body | VariableEntity, recorded as input | return |
| body | fns | noteUse: lambda reach misses decl |
| fns | vars | noteCaptured: inCell gets decl name |
| body | vars | typeOf(entity): #types.get(decl name) |
| vars | body | Int, recorded on the use node | return |
| phase | Lower one instance |
| low | vars | targetsOf(decl), inCell(decl name) |
| vars | low | binding; cell register | return |
| low | link | entityOf(use name) |
| link | low | entity: registerOf(entity.name) | return |

@steps id=variable-steps
| vs-expect | expect | The block pre-pass notes `total` as pending, so `total` used above its `let` says "used before declaration". | variable-flow | scope |
| vs-define | define | The entity's `name` is the declaring `Identifier` object itself; that object is the key everywhere after. | variable-flow | lb |
| vs-input | entityOf | `useEntity` asks `Bindings.entityOf` through `recordedBindings`, so the answer joins the reads of the entry checking this body.[](source:inputs) | variable-flow | link |
| vs-capture | noteUse | A frame captures the variable when its `reach` span does not enclose the declaring name's span; a captured `let` goes into `#inCell`.[](source:functions) | variable-flow | fns |
| vs-type | typeOf | `variableType` asks `declaredOutsideBodies` first, then `VariableScope.typeOf(entity)`, which reads `#types` by `entity.name`. | variable-flow | vars |
| vs-lower | registerOf | `declareVariable` makes a cell register when `inCell(decl name)`, and `lowerName` finds it by `entity.name`.[](source:lowervars) | variable-flow | low |

## How does one node get a different type in each field-loop pass? {#pass-records}

A field loop over `{ id: Int, label: String }` checks its body once per field. The loop's `value` and every expression using it get one record per pass.

@sequence id=pass-flow title="Field loop: one node, one record per pass"
| actor body | BodyChecker | backend |
| actor passes | Passes | backend |
| actor tables | PassTables | database |
| actor view | CheckedBody | backend |
| actor low | lowering | backend |
| phase | Check |
| body | passes | fieldPasses(header, [id, label]) |
| passes | body | run check in pass 1 (id) |
| body | tables | set(value name, Int), set(use, Int) in pass 1 |
| passes | body | run check in pass 2 (label) |
| body | tables | set(value name, String), set(use, String) in pass 2 |
| passes | body | held diagnostics, reported once | return |
| body | tables | #fieldPasses.set(header, passes) |
| phase | Lower |
| low | view | passesOf(header) |
| view | low | one CheckedBody per pass | return |
| low | view | inFieldPass(id): typeOf(use) |
| view | tables | get(use, pass 1), walking outer |
| tables | low | Int | return |
| low | view | inFieldPass(label): typeOf(use) |
| tables | low | String | return |

- A pass is just `{ outer }`. `PassTable.set` writes into the current pass's map; `get` walks `pass.outer` to the root, so a node outside the loop answers inside it.[](source:passes)
- Facts every pass shares stay out of pass tables: `#changed`, `#inCell`, `#references`, label targets, and a function's returns.
- A diagnostic made inside a pass is held, then reported once; a "never runs" diagnostic only when every pass made it.
- A pass for fields a struct constraint leaves unnamed is read through `CheckedBody.instantiated` with the field's key substituted.[](source:passbody)

## Who reads these records later? {#readers}

| Reader | Asks | Gets it from |
| --- | --- | --- |
| Lowering, a declaration | `targetsOf(owner)`, `inCell(name)` | `VariableScope.#targets`, `#inCell`, through `CheckedBody.instantiated` |
| Lowering, a name read | `entityOf(name)`, then `registerOf(entity.name)` | binder, then lowering's own `#registers` |
| Lowering, a closure | `functionOf(lambda).captures` | `FunctionScopes.#checked` |
| Lowering, any value | `typeOf(node)`, `fitAt(site)` | `BodyChecker.#types`, `#fits`, substituted per instance |
| Hover and inlay hints | `declaredTypeOf(entity.name)` | `bodyHolding(...)` then `VariableScope.#types`[](source:denotations) |
| Completion | `visibleAt(module, offset)` | `VisibilityNotes` snapshot, then prelude, then variants |
| The unused-`let` warning | `#types` entries without `#changed` | `VariableScope`, when the body finishes |
