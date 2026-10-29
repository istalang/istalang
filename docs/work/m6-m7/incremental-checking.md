---
description: P5 design — incremental checking at function-body granularity with early cutoff (entries keyed by what they read, segments, positions in the tree), its phases 7A.3–7A.7, acceptance and latency budget; read before implementing or examining any P5 phase, or changing how syntax positions, function bodies or checker caches work
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [plan, m7, p5, incremental, checker, syntax]
---

# Incremental checking (P5)

On 2026-10-29 the human chose **body level, salsa style**: an edit inside one function body re-checks that body. The alternatives were module level (reuse whole modules) and deferring P5.

## Baseline (2026-10-29, Apple M2 Max, Node 26)

Each figure is the median of 30 edits, timed from the new text to the edited module's diagnostics. Today each edit builds a new checker.

| Module | Build (scan, parse) | Link | Check | Total |
| --- | --- | --- | --- | --- |
| std `prelude.test.ista`, 246 lines | 1.7 ms | 0.6 ms | 7.9 ms | ~10 ms |
| 2,098 lines: std `decimal.test.ista` ×7, functions renamed | 8.7 ms | 3.0 ms | 24.4 ms | ~36 ms |

The modules are project test modules over the shipped std. Each other open document costs its own check again.

## Mechanism

### 1. Checker results are entries keyed by what they read

**What becomes an entry.**
- **One table unit.** Every checker cache becomes an entry of one generic table unit in `structures/`, beside `memo`. That covers bodies, results, signatures, layouts, constants, aliases, statics, type parameters, JSON forms, annotations, clashes, expansion and lookups. `LazyChecks` folds into it, so one running stack serves memoization and cycles alike.
- **No state outside entries.** A side queue or a map filled as a side effect becomes an entry or part of one's value. Known cases:
  - the pending constraint checks of `TypeParameters.constrainLater`;
  - `Annotations`' checked bodies;
  - `Annotations.ofField`'s memo, which checks the type of whatever instance asked first, an order dependence.
- **Conformance stays uncached.** It depends on its site (`toHost`), reports there, and uses coinductive state, so it runs inside the entry that asks.

**What an entry records, while it computes:**
- **Its reads**, each with the value it saw:
  - the Program inputs it read, read narrowly: a function's body (`bodyOf(tree, fn)`, by identity), a module's headers (element-wise), its resolved imports (by value), its flags, and `roles`;
  - the Bindings answers it used;
  - the other entries it read.

  It never reads a whole `ProgramModule`. Indexes over every module (`DeclaringModules`, `TypeParameters`, expansion's list of generic functions) are built per module, on demand.
- **Its diagnostics**: those reported while it ran (§3).

**Adoption.**
- **Making a checker.** `checkProgram(program, previous?)` makes a checker that may take over entries from `previous`. It adopts an entry when every recorded read gives an equal answer now.
- **Early cutoff.** Reads are verified depth first. An entry read is verified or recomputed in the new checker, and a recomputed read equal to its old value ends that branch of the walk.
- **Equality per kind:**
  - Types compare everything `typeText` shows: `sameType` plus aliases and the order of an `any`'s constraints.
  - Signatures, layouts and member lists compare element-wise, with nodes and entities by identity.
  - Constants compare type and form.
  - A body is never equal.
- **Splits for cutoff.** An entry bundling a value with a body splits, so the value can cut off:
  - parameters split apart from their defaults' body (`Parameters`);
  - a constant splits apart from its initializer's body (`ConstantChecks`).
- **Narrower entries.** A reader of a body reads a narrower entry of it: its result type, or its expansion edges.
  - Edges compare by callee, parameter, argument and growth, not by call site.
  - The graph's entry holds the offending edges. A per-caller entry reports them at its call sites.
  - A lookup reads only the entry it needs. Today `Lookup` asks for its module's diagnostics.

**Cycles.**
- Every entry on the stack, from the cycle's member to the top, is marked and never adopted.
- Every member of a cycle answers the stand-in, whichever member was entered first. That keeps answers independent of the order of asking. It changes behaviour for invalid programs, in 7A.3.

**Memory and the memo.**
- A checker adopts only from the checker it was made from, and making it releases that checker's own `previous`. At most two revisions' tables are held. An entry the newest checker never asked for is recomputed if a later one asks.
- `checkProgram` keeps the first checker made for a Program, since every checker of a Program answers alike. Tests compare against a checker made apart from that memo (test kit).
- The Checker surface gains only the optional parameter.

### 2. Identity survives an edit: segments

Today an edit re-parses the module, so every node and entity in it is new, and so is every key above. Identity therefore has to come from syntax that does not move.

**Segments.** A segment is either:
- a header: of a top-level item, or of a trait member. It runs up to its body, and a function's docstring belongs to it, so its body's segment starts after the docstring;
- a function body not nested in another body.

A top-level constant's initializer belongs to its header, as do parameter and field defaults: editing them changes a declaration. Lambdas and local functions belong to the body around them.

**Positions are in the tree.**
- **Spans.** A node's span is relative to its own segment and names that segment's token. The tree knows each segment's base. `spanIn(tree, span)` gives text positions, and `extentIn(tree, node)` gives the text a node and everything under it cover, through bodies and members.
- **Header spans.** A function's or trait's own span covers its header only.
- **Containment.** Code that relies on a parent's span enclosing its children's moves to `extentIn` or to ancestry (`parentOf`). That is `nodesAt`, the formatter's comment placement, and `closures/functions.ts`'s test of where something was declared. Spans of different segments never compare; a comparison across segments goes through the tree.
- **Where conversion happens.** Inside the toolchain, spans pass through unchanged. Code converts only where it needs a text position:
  - diagnostics leaving a phase;
  - the LSP and the formatter;
  - lowering's source positions;
  - `nodesAt`;
  - `visibleAt`, whose notes keep anchored positions and convert in `namesAt`.

  The anchored span type is not assignable to the text `Span`, so the compiler finds every such place.

**Function bodies are reached through the tree.**
- `FunctionDeclaration` has no `body`. `bodyOf(tree, declaration)` answers for every function, local ones included, and the generic traversal takes the tree.
- A function's header node is its identity everywhere: calls resolved, `#bodies`, lowering's function table. This way it survives an edit of its body.
- In 7A.5 a function's span still covers its body, so containment holds until 7A.6.

**Incremental parse.** `buildProgram(…, previous)` re-scans and re-parses a changed module whole (9 ms per 2,000 lines). It then reuses every old segment whose text equals a new one:
- a header, when its text is equal, comments included;
- a body, when its text is equal and its function's header was reused.

**Binding by segment.**
- A header's entities are memoized on the header.
- A module's scope, its overload sets, its bare-variant entities (`VariantsEntity`, per `LocalBinder` today) and the sets of functions only ADL may find (`link.ts` `#unseenFunctions`, per Program today) are memoized on its list of headers.
- A body's bindings are memoized on the body and its function's header scope: type parameters, parameters, `Self`, and the function itself, for its own call.

Reused segments therefore keep their nodes and their entities, and everything entries recorded about them stays valid.

**Type keys.** Identities are numbered by one module-level WeakMap, so an entity keys alike in every checker. A key's numbers must never reach lowering's output. 7A.3 checks this, and if they do, lowering numbers what it emits itself.

### 3. Diagnostics are carried by entries

- **Where reports go.** `report` adds to the entry running. A report outside every entry is a broken invariant.
- **Cycles.** A cycle's report is kept by its member's own entry.
- **One module's diagnostics.** `diagnosticsOf(M)` is the set reported at M by the entries that M's module check reads, transitively. It is sorted by (start, end, code, message), so ties don't depend on what was asked first.
- **Order independence.** Every diagnostic about M must come from an entry that M's check reads. A rule that reports at a declaration only when a use elsewhere triggers it (such as a derived codec) is moved to the use site, or made part of its declaration's check.
- **Positions.** An entry keeps anchored spans, so adopting it needs no rebasing. The text positions come out at the module boundary (`diagnosticsOf`, `diagnoseModule`).

### 4. What changed

- **Reads decide.** Entries record narrow reads (§1), so a changed module invalidates only what read the changed part.
- **Edits that count as changes:**
  - a module whose text is unchanged but whose imports resolve differently (a file added makes an import ambiguous) changes its imports read;
  - a re-parsed module whose segments were all reused keeps its headers, bodies and entities.
- **Reading files is not P5's job.** Every build reads every module's text. 7.1's loader reads disk texts through `diskFiles` each time. If a benchmark shows that cost, the LSP's loader keeps disk texts in memory, refreshed on file events.

### Rejected

- **Ids that don't depend on position, with position-independent results** (rust-analyzer's HIR). Every declaration's identity in the binder, checker and lowering would change, and every `CheckedBody` table would be keyed by body-local ids, with a converter for each result type. That rebuilds the checker's node-identity memoization instead of extending it.
- **Signals libraries** (alien-signals, `@preact/signals-core`, the TC39 `signal-polyfill`). They hold one mutable current value, so an older snapshot's answers would change under its readers, and they have no keyed tables, cycle semantics or diagnostics per entry. No salsa port exists for JS or TS (searched 2026-10-29).
- **Re-scanning only the edited region.** Parsing is layout-sensitive, which makes the region's bounds subtle, and a whole re-parse fits the budget. Revisit only if the budget fails.

## Phases

| Phase | Kind | Scope | qa |
| --- | --- | --- | --- |
| **7A.3** Entries | structural, and order independence | the one table unit with `LazyChecks` folded in; every checker cache as entries recording the entries they read, with no state outside them; diagnostics per entry and derived per module; cycle members all stand in; tie order; type keys | yes |
| **7A.4** Revisions | behaviour | `checkProgram(program, previous)`, adoption and early cutoff (§1); narrow input reads and Bindings answers recorded; the splits; per-module indexes; link-made sets per module; expansion as edges, graph and per-caller reports; a test seam `observe` counting body checks; the language service passes its previous checker | yes |
| **7A.5** Bodies through the tree | structural | `FunctionDeclaration` without `body`; `bodyOf(tree, …)`; the traversal takes the tree; every reader migrated | no¹ |
| **7A.6** Positions in the tree | structural | segments and their tokens; anchored spans; `spanIn` and `extentIn`; header-only spans; containment moved (§2); the parser emits anchored spans; every reader of text positions converts | no¹ |
| **7A.7** Incremental parse and binding | behaviour | segment reuse (§2); binding by segment; the benchmark | yes |

¹ These phases change no behaviour. The suite and the golden outputs cover them, and each gets a reviewer.

**Order and conflicts:**
- 7A.3 and 7A.4 touch checker internals, `program.ts` and `link.ts`, so they can run beside 7.2a and 7.2b.
- 7A.5 and 7A.6 change the syntax contract, which has high fan-in, and migrate every caller on `main`, the LSP providers included. Each runs with no other branch open on syntax consumers.
- 7A.7 follows 7A.6.

### Acceptance

The edit generator is a fast-check program over corpus programs and std test modules. It inserts, deletes and replaces text inside a body, adds and removes items, edits signatures, and renames.

**7A.3**
- The suite passes, except for the order of tied diagnostics and for diagnostics that follow from a cycle's stand-ins.
- Each module's diagnostics equal those of asking in load order. This holds over every corpus program and std test module, even when modules are asked in a random order after random lookups and `bodyOf` calls. Programs with cycles are included.
- A report made outside every entry throws, and nothing in the suite does so.
- Two checkers of the same Program give equal keys to the same type.

**7A.4**
- **Incremental equals fresh.** Over random edit sequences, `checkProgram(pᵢ, cᵢ₋₁)` matches a checker of `pᵢ` made apart from the memo, so nodes compare by identity. It does so in every module's diagnostics and in every query's answer, over every node of every module (7A.1's sweep).
- **Only what changed, module level.** After an edit to a module nothing imports, asking every module's diagnostics checks no body outside it. A std body checked in the first revision is never checked again. Both are counted through `observe`.

**7A.5, 7A.6**
- The suite passes.
- The CLI's outputs over the corpus and the std modules are byte-identical to those captured before the phase: `check` diagnostics, `run`, `test` and `fmt`.
- In 7A.6, `extentIn` of every node encloses `extentIn` of its children (`tree.test.ts`'s position property, moved to the tree).

**7A.7**
- **Parse.** Over random edit sequences, the tree built incrementally matches a fresh parse: its dump, with text positions through `spanIn` and `extentIn`, its comments and its syntax diagnostics.
- **Reuse.** After an edit inside one function body, every other segment of the module is the same object, and so is every entity bound in them.
- **Incremental equals fresh.** This is the parse property composed with 7A.4's.
- **Only what changed.** An edit inside one function body that changes no declaration and no inferred result re-checks only that body, counted through `observe`. That holds even when every module's diagnostics are asked.
- **Budget.** In a vitest bench on the fixtures above, the median of 30 edits inside one body, from new text to the edited module's diagnostics, is:
  - ≤ 15 ms on the 2,098-line module (today 36);
  - ≤ 5 ms on the 246-line one (today 10).

  The reference machine is an Apple M2 Max. Parsing (9 ms) is most of the first figure.

## Plan impact

- `plan.md`'s "Checker surface additive only" holds: `checkProgram` gains an optional parameter.
- The syntax contract is not additive. 7A.5 and 7A.6 change the shape of `FunctionDeclaration` and of node spans, and update every caller. This amends the plan and needs the human's approval.
- P5's build is 5 phases. The plan's "P5 first among the last group" holds for 7A.3 and 7A.4. For 7A.5 and 7A.6, the tech-lead weighs migrating 7.2's providers afterwards against making them wait.
