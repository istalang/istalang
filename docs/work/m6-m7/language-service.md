---
description: M7 details — what the compiler lacks for a language service (research of 2026-10-29), phase scopes, contracts, libraries and falsifiable acceptance; read before implementing or examining any M7 phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [plan, m7, lsp, language-service]
---

# M7 — Language service, LSP and client

## Gaps found (2026-10-29)

**Syntax**
- No node-at-offset query and no parent query exist, although `architecture.md` lists node-at-offset.
- `childrenOf` sorts on every call.

**Binder**
- Nothing indexes the uses of an entity.
- Scopes are dropped after binding, and they have no spans.
- One `Scope` object is mutated statement by statement, so a name declared later in a block is pending at earlier offsets.
- `is` bindings flow across `and` and `then`.
- Bare variants never enter a scope: they live in `ModuleScope.variants` and resolve as free names to a `VariantsEntity`.
- Locals have no `moduleOf`.

**Checker**
- What an identifier denotes is recorded only for `MemberAccess` field reads. Field names in literals, pattern fields, struct assignment targets and the variant a bare name chose are not recorded.
- The types of declared names (`let`, parameters, `for`, pattern bindings, `select … as`) are private to `VariableScope`.
- The identifier in a shorthand (`Pair{first}`, `case Pair{first}:`) is a field and a variable at once.
- Five paths own checked bodies:
  - `bodyOf`;
  - `defaultsOf` of a function;
  - `defaultsOf` of a fields function;
  - `constantBodyOf`;
  - annotations, which throw their body away.
- A tagged template is checked through a synthesized `Call`.
- `fieldReadOf` and `patternOf` throw on unchecked nodes, `Checker.moduleOf` throws on locals, and `typeOf` answers `errorType` for an unchecked node.
- `typeText` and the type of a written `TypeNode` are outside the surface.
- Members found by ADL and statics can't be listed.
- The candidates at a call site aren't kept.
- No query gives one module's diagnostics.

**Loading and layers**
- The file loader and source discovery live in `cli/`, and only `cli` may import Node built-ins.
- `stdlib-loader.ts` reaches every native (Q14).
- `loadProject` ignores its `std` argument for roles. The std loader refuses `prelude` by design (§3.13).
- `ista lsp` would make `cli` import `lsp`, two apps. So `lsp` moves to the tooling layer, beneath `cli`.

**Incrementality (P5)**
- Every Checker cache belongs to one Program.
- Type keys are numbered per checker.
- Diagnostics are a side channel that is "reported once, by whoever asks first".
- Entities are made per tree, so an edited module's entities are new objects.
- `buildProgram` re-reads and re-resolves every module.

## Libraries

- **Server:** `vscode-languageserver` 10.1.2 with `vscode-languageserver-textdocument` 1.0.15. The packages are CJS; named imports from ESM work. Import `vscode-languageserver/node`; `/node.js` is not exported.
- **Client:** `vscode-languageclient` 10.1.2, which needs VS Code `^1.91.0`, so the extension's engine moves up from `^1.89.0`.
- **Not yet:** the 11.0 / 3.18.5 line, released 2026-10-22.
- **Tests:** run in-process over two `PassThrough` streams: the server from `createConnection`, the client from `vscode-jsonrpc/node`'s `createMessageConnection`. No maintained harness exists.

## Phases

**Before any fork**, the tech-lead commits:
- the layers, in `.dependency-cruiser.mjs` and `architecture.md`:
  - `formatter`, which may import scanner, parser, syntax, text and diagnostics;
  - `language-service`, which has no `node:*`;
  - `project` and `lsp`, which may import Node built-ins;
  - `lsp` beneath `cli`;
  - `type-text.ts` in the checker surface.

Phases add rules only for their own modules.

**7B — Service infrastructure** (owns the syntax and binder queries)
- Syntax:
  - `childrenOf` is memoized.
  - New queries: `parentOf`, and `nodesAt(tree, offset)` (root to innermost).
- Binder:
  - The uses of each entity, across modules.
  - The names visible at an offset, kept per binding from where it starts:
    - block names from their declaration on;
    - `is` bindings over the region they flow into;
    - imports, prelude exports and bare variants.
  - Locals answer `moduleOf`.
- Q14:
  - One std list of `{name, source}`, which the std loader reads.
  - `std-modules.ts` attaches natives to that list rather than keeping a second list.
- Loading:
  - The file loader and source discovery move to `project/`.
  - An overlay loader serves open texts before disk.
- `loadProject` lays its std loader over `stdRoles()` role by role, so `prelude` still loads.

**7A.1 — Checker surface** (owns the checker queries; additive-only after it)
- Q3: `instantiatedBody` substitutes the typed tables through one table-keyed record, so a typed table that is added and not substituted fails to typecheck.
- **What an identifier denotes.** One query, `(module, identifier)`, answers for any identifier in a module, the declaration it names and its type. That covers bodies, signatures, imports, type annotations, `fn Owner.name` and declaring names, the binder's answers included. The declarations are:
  - variable, parameter, field or variant;
  - function, type or namespace.

  Checking records what is missing today:
  - field names in literals, patterns and struct assignment targets;
  - the variant a bare name chose;
  - the types of declared names.

  A shorthand answers both its field and its variable. Top-level `const` destructuring records its targets.
- **The body holding a node**, routed over all five owners. Annotations keep their checked body. A tagged template answers through its synthesized call.
- Further queries:
  - the type a `TypeNode` denotes;
  - the members of a type (fields, variants, methods ADL finds, statics);
  - the candidates at a call site.
- `typeOf`, `fieldReadOf` and `patternOf` answer `undefined` for an unchecked node, and `moduleOf` answers for locals.
- One module's diagnostics; `diagnose` is built from it.

**7A.2 — P5 design**
- Writes `incremental-checking.md`, covering:
  - what results are keyed by, in place of the Program;
  - how entities and type keys keep their identity across an edit;
  - diagnostics carried by results;
  - which modules changed;
  - the phases and the latency budget.
- Reviewed by a fork of the root reviewer, then approved by the human.

**7.1 — Server**
- `language-service/` is protocol-free: a workspace of open texts over disk, built with `buildProgram(…, previous)`.
- `lsp/` holds the connection, maps URIs to `ModuleId`s and LSP positions to offsets, and holds one provider per file in a typed table.
- `ista lsp` runs it over stdio.
- Providers:
  - push diagnostics;
  - document symbols;
  - folding;
  - full semantic tokens, from syntax, contextual keywords included;
  - formatting, as one whole-document edit from `formatTree` (stubbed until 6 merges).
- **The std-source request** (7.1 serves it, 7.3 calls it): `ista/source` (`{ uri }` → text). It serves std modules under their `std:` ids as read-only documents.

**7.2a — Navigation**
- Definition, references and rename, through the identifier query. They cover names, fields, variants, methods and statics, across modules.
- References of a field, method or static are built from that query over every module, memoized per Program, since 7B's `usesOf` sees only binder entities.
- Rename expands a shorthand (`first: x`, `first as x`) and refuses std declarations.

**7.2b — Types**
- Hover: the type, plus the docstring.
- Inlay hints for unannotated `let`/`const` targets, destructuring included, for `for` targets, and for untyped lambda parameters.
- Signature help, with the active parameter.
- Completion:
  - the visible names;
  - members after `.`, `?.`, `->` and `?->`, and after a qualifier (`m.`, `Color.`);
  - keywords.

**7.3 — Client**
- The extension in `.vscode/extensions/ista/`, bundled.
- It starts `ista lsp` from the setting `ista.server.path`; the default is the workspace's `node_modules/.bin/ista`, then `ista`.
- It registers a read-only content provider for the `std` scheme, through `ista/source`.

## Acceptance

Properties run over every corpus file and the std modules, through the in-process client, unless a phase says otherwise.

**7B**
- `nodesAt`: the innermost node encloses the offset, and none of its children does.
- `parentOf` inverts `childrenOf`.
- Every identifier the binder resolves is among `usesOf` of its entity.
- At every name the binder resolves through scopes, the names visible at that name's start include it, bound to the same entity. Those scopes are local, module, import, prelude and bare variant.
- Qualified segments, ADL callees and declaring names are excluded from that property: 7.2b completes them as members.
- The std loader's import graph reaches no `runtime/` and no `natives.ts` (enforced by a cruiser rule).
- `project.test.ts` still loads every role with an overlaid std loader.

**7A.1**
- Over every node of every valid and invalid corpus program, no checker query throws. The queries include `patternOf` and `moduleOf`.
- Every identifier the binder or checker resolves inside a checked body has an answer from the identifier query. It names the same declaration that `entityOf`, `resolved` or `fieldReadOf` gives where those answer.
- After lowering instantiates a generic function, no typed table of its instance names that function's type parameters.

**7A.3…**, fixed now; the design adds its own:
- **Incremental equals fresh:** over random edit sequences on corpus programs, each snapshot's diagnostics and every query's answer equal a fresh check's.
- **Only what changed:** an edit inside one body that changes no declaration and no inferred result re-checks only that body, counted through a test seam.
- The design's latency budget holds in a benchmark.

**7.1**
- Each open document's diagnostics equal `ista check`'s for that module, and they update after `didChange`.
- Symbols list every declaration and its members.
- Folding covers every block spanning lines, every multi-line item list (struct, enum, trait, `match`, `select`) and every multi-line bracket list.
- Every identifier, keyword, literal, comment and operator token has a semantic type. Punctuation has none.
- Formatting equals `formatTree`'s output.
- `ista/source` returns each std module's text.

**7.2a**
- From every identifier the identifier query answers, definition lands on the declaring name.
- `references` of a declaration equals the set of its uses.
- Renaming to a fresh name, shorthands included, leaves `ista check`'s diagnostics unchanged, and every use still resolves to the same declaration.

**7.2b**
- Hover shows `typeText` of:
  - every expression `typeOf` answers;
  - every declared name the identifier query types.
- Every unannotated target in 7.2b's scope gets an inlay hint of its type.
- On every call:
  - a call resolved to a function gets signature help that includes it and marks the parameter of each written argument; a method's receiver is not counted.
  - a call of a function value gets its type's parameters.
- At every scope-resolved name, completion offers it.
- At every member access, completion offers the member.

**7.3**
- A unit test shows the client spawns `ista lsp`.
- The human installs the extension from its location and sees diagnostics, hover, and go-to-definition into a std module on a corpus file.
