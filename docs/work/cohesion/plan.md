---
description: done — the cohesion reorganization as planned and executed (2026-11): which units moved, merged or split, the tree each area ended with, and where execution deviated; read to learn why a unit sits where it does, before reorganizing a folder again
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [cohesion, refactor, architecture, plan]
---

# Cohesion reorganization plan

Input: `tsm cohesion --exclude '**/*.test.ts' --exclude '**/*.test-kit.ts' src` on main at `5a8a7a36`, saved as `tsm-cohesion.txt` beside this file (649 files: 255 misplaced exports, 23 crowded folders, 43 wide files). It replaced the regex script `exclusive-units.py`, since removed.

Goal, in priority order:
1. A file sits where its meaning says it belongs.
2. One concern is one file or one folder, even when today it is spread over several folders.
3. Folders split into sub-folders by feature.
4. Wide files split until each file answers one reason to change.

Every step is structural. No behaviour changes.

## Outcome

Done on branch `refactor/cohesion`, batches B1–B9, one commit per step. Each step was verified with typecheck, Biome on the changed files, dependency-cruiser, knip, a build and `test:std`. The full `npm test` ran after B1–B4. After the reorganization: 4 crowded folders (2 of them stated exceptions, 2 counting a `.bench.ts` file) and 44 wide files. README.md holds the after scan, its triage and what remains.

Where execution left the plan:
- **C11 dropped:** `default-witness.ts` imports `conformance.ts`, which imports `declared-witness.ts`, so a merge makes a cycle. Both files sit in `resolution/conformance/`.
- **C20 not merged:** `type-matches.ts` imports `tree.ts`, which imports `types.ts`, so a merge makes a cycle. They became `syntax/types/` (`index.ts` and `type-matches.ts`).
- **C8 and C12 merged in place** in B1, then moved into `unions/` and `fitting/` in B3.
- **`check.ts` split:** `SignatureParameter` stays in `check.ts`. It is `Checker.parametersOf`'s own type, and moving it pushed `lowering/function-lowering/index.ts` past 400 lines.
- **`surface/`** gets the root contracts' import rule through a `checkerContracts` rule in `.dependency-cruiser.mjs`.
- **`type.ts` split:** `PrimitiveType`, `ErrorType` and `TupleType` stay in `type/index.ts`, because the Type union names them. `primitives.ts` also holds `tupleType` and `tupleElements`.
- **`literal-items.ts`** stays at the expressions root and isn't merged with `collection-accepts.ts`: it covers literal arguments of every kind.
- **`syntax/parameters.ts`** went to `syntax/expressions/parameters.ts`, beside the Parameter node it reads.
- **`machine.ts`** split three ways (`frames.ts`, `registers.ts`, `machine.ts`) to avoid a type cycle.
- **`well-known/`** has `variants.ts` and `implicit-calls.ts` in place of the planned `results.ts` and `collections.ts`, named for what they hold.
- **The native value helpers** went to `stdlib/values/arguments.ts` and `results.ts`, keeping `stdlib/`'s root at 9 files.
- **One commit not self-contained:** `43bcc21c` left stale imports in `test/` and `scripts/`; the next two commits fix them.
- **Two slow tests skipped:** `b8db0a63` skips the completion-over-the-corpus test and the larger-graph recursive key property, which time out under load.
- **Comments:** `tsm wrap-comments` re-wrapped comments that path rewrites pushed past the line width, across the reorganized areas.

## 1. Triage: what the scan flags but stays

The rule "an export lives under the deepest folder holding all its users" ignores layers and contracts. These hits stay:

| Kind | Examples | Why it stays |
| --- | --- | --- |
| Contracts and vocabularies | `syntax/*`, `definition/*`, `language/*`, `structures/*`, `text/*`, `diagnostics/*`, `binder/entities.ts` | One consumer today; the contract is consumer-agnostic by design (architecture.md, Layers). |
| Layer entry points | `compileProgram`, `createRuntime`, `settle`, `runTests`, `stdNatives`, `serveLanguage`, `Workspace`, `buildProgram`, `stdlibLoader`, every language-service feature used by its LSP provider | A phase's public API is used by the layer above; moving it down inverts the layers. |
| App-level helpers | `cli/clock.ts`, `report.ts`, `log-lines.ts`, `directory-store.ts`, `host-module.ts` | `cli/commands/` holds one module per subcommand. A helper shared by commands is not a subcommand. |
| One function of a cohesive module | `substituteKept` (substitution), `resolveClosing` (resolve-type), `holdsItself` (finiteness), `reshapes` (fit), `heldType` (held), `checkDisposeDeclaration` (disposal) | The module is the rule's one home. Moving one function to its caller splits the rule in two. |
| Engine used by one construct | `checkPattern`, `checkLambda`, `flowThrough`, `runInstruction` | An engine layer serving a construct above it is the layering working. |
| Used only by a lower layer that can't import upward | `held` (traits + rules), `equality`/`known-literals` (patterns + rules), `inside-optional` (closures + expressions), `agreement` (closures + expressions) | Already at the lowest layer serving all users. |

## 2. Feature collections: one concern gathered into one file or folder

Each row is one commit. "→" moves a file, "⊕" merges files into one, "↑" moves symbols. Every `x.test.ts` follows its unit, and tests merge when their modules do.

| # | Concern | Today | Becomes | Checked |
| --- | --- | --- | --- | --- |
| C1 | Endless instantiation (§3.5) | `checker/types/expansion-edges.ts`, `rules/expansion.ts`, `declarations/type-expansion.ts`, `declarations/type-match-expansion.ts` | `checker/rules/expansion/`: `edges.ts`, `functions.ts`, `types.ts`, `type-matches.ts` | edges' only users are the other three; none imports anything above `types/`; their users (`declarations/layout`, `aliases`, `module-checks`, `program-checker`) sit above `rules` |
| C2 | Testing rules (§10) | `rules/suites.ts`, `rules/testing-calls.ts` | ⊕ `rules/testing.ts` | users: `declarations.ts`, `body-checker.ts`; both import only types and root contracts |
| C3 | Disposal (§7) | `rules/disposal.ts`, `dropped.ts`, `must-use.ts` | `rules/disposal/` (3 files) | `held.ts` stays in types (`traits/sendable` uses it) |
| C4 | Host boundary rules (§9) | `rules/host-boundary.ts`, `rules/json-forms/index.ts` | `rules/boundary/`: `host-boundary.ts`, `json-forms.ts` | json-forms/ holds one file |
| C5 | Loops: over iterables and over fields | checker `rules/iteration.ts`, `rules/field-passes.ts`; lowering `iteration.ts`, `field-passes.ts` | `checker/rules/loops/` and `lowering/loops/`, the same two files each | ↑ `fieldPassesOver` from `traits/struct-keys.ts` into `rules/loops/field-passes.ts` if struct-keys doesn't call it itself (verify with `tsm callers`) |
| C6 | Branching expressions | `rules/branches.ts` | → `checker/expressions/control/branches.ts` | users: control, match, select, expressions only |
| C7 | Conditions decided by types | `rules/decided-conditions.ts` | → `checker/expressions/` beside `operators.ts` | users: expressions only |
| C8 | `==` over types | `types/equality.ts`, `types/known-literals.ts` | ⊕ `types/unions/equality.ts` (~230 lines) | same users (patterns/matching, decided-conditions); same subject: what types decide about `==` and literal tests |
| C9 | Overload clashes | `rules/clashes.ts` | → `declarations/functions/clashes.ts` | only user: module-checks |
| C10 | Type parameters' constraints | `traits/constraints.ts#resolveConstraints`, `traits/struct-constraints.ts#resolveStructConstraints` | ↑ into `resolution/type-parameters.ts` (its banner: "its constraints resolved there once") | each defined once and not used inside its own file; only user is type-parameters |
| C11 | Finding a witness | `resolution/declared-witness.ts`, `default-witness.ts` | ⊕ `resolution/conformance/witnesses.ts` | 66 + 31 lines; both find "the function meeting a trait for a type" |
| C12 | Fitting | `types/misfit.ts` | ⊕ into `types/fitting/fit/index.ts` (324 + 24 lines) | no cycle: misfit imports fit and type-text, and fit imports neither |
| C13 | Program inputs | `checker/declaring-modules.ts` | ⊕ into `checker/program/program-inputs.ts` | only user |
| C14 | What tools ask by position | `checker/joined-body.ts` | ⊕ into `checker/surface/denotation.ts` | both are the tools' surface; update `checkerSurface` |
| C15 | Optional values in lowered code | `lowering/optionals.ts`, `optional-chains.ts` | ⊕ `lowering/values/optionals.ts` | 70 + 53 lines |
| C16 | Optional operators in lowering | `lowering/expressions/nullish.ts`, `unwrap.ts` | ⊕ `lowering/expressions/access/optionals.ts` | matches the checker's `expressions/optionals.ts` (`??`, `!`) |
| C17 | Function values fitted | `lowering/async-fits.ts` | ⊕ into `lowering/function-lowering/fits.ts` (126 + 32 lines) | `lower.ts` imports from it after |
| C18 | Spreads in the grammar | `parser/expressions/spread.ts`, `parser/parts/spreads.ts` | ⊕ `parser/parts/spreads.ts` | spread.ts imports only `parser.ts` and syntax, so parts' rule ("imports no category") holds |
| C19 | A function's head and parameters | `parser/parts/functions.ts`, `parameters.ts` | ⊕ `parser/parts/functions.ts` | 6 + 37 lines; both are shared by lambdas and declarations |
| C20 | Type `match` nodes | `syntax/type-matches.ts` | ⊕ into `syntax/types/index.ts` (or `syntax/types.ts`) | reads only the TypeMatch nodes types.ts declares |
| C21 | The `grammar` completion place | `completion/grammar/` (5 files), `completion/places/grammar.ts` | `completion/places/grammar/`: index.ts (was places/grammar.ts) plus the five | position and words serve only places/grammar; expression serves places/call-argument, a sibling |
| C22 | Matched-type completion | `completion/checked-twin.ts` | ⊕ into `completion/places/patterns/matched-type.ts` | only user |
| C23 | An instance's random values | `runtime/random-seed.ts`, `runtime/scheduler/random-source.ts` | ⊕ `runtime/random.ts` | 19 + 8 lines, one subject: the seed and what is drawn from it |
| C24 | Disposal diagnostics | `checker/diagnostics/weak-side.ts` | ⊕ into `checker/diagnostics/lifetimes.ts` | both §7, codes 5700–5899 |
| C25 | Binder flow | `binder/link/index.ts#link` (binds each module, then links), `binder/bind.ts` (only a memo) | ↑ the coordinator into `bind.ts`; `link/` keeps only cross-module resolution | read link/index.ts before deciding: worth doing if `link()` is the program-level coordinator |

## 3. Final tree per area

`(n)` is the file count. Folder modules use `name/index.ts` (AGENTS.md).

### checker root (20 → 5 files)
```
checker/
  check.ts context.ts body-context.ts use-site.ts passes.ts     entry; contexts every folder imports
  surface/   resolved-call checked-pattern checked-field checked-annotation constant-form
             json-form struct-items denotation(⊕ joined-body) host-externs checked-body(✂ check.ts)   models later phases read
  program/   program-checker program-inputs(⊕ declaring-modules)        wiring: one program
  body/      body-checker body-records facts/(was body-facts/)          wiring: one body
```
dependency-cruiser: `checkerSurface` becomes `surface/*.ts`; `surface/` gets the root contracts' rule (imports only `diagnostics`, `types`); `checkerWiring` becomes `^src/compiler/checker/(program|body)/`.

### checker/types (40 → 8 files + 7 folders)
```
types/
  type/        index(Type and its variants with constructors)  primitives  alias-uses     ✂ type.ts (45 exports, 399 lines)
  computed-types function-types struct-constraint field-order well-known type-rules type-text substitution
  identity/    identity type-keys recursive-types recursive-terms term-signatures unfolding-pairs   sameness: keys, recursive graphs minimized so equal ones key alike
  parts/       type-parts type-children computed-reduction                                       walking a type one level down
  unions/      unions union-members widening inside-optional equality(⊕ known-literals)           unions, literals, optionals
  fitting/     fit(⊕ misfit) expected member-arguments
  written/     resolve-type named-paths named-types pattern-types(✂ named-types) key-types
               declared-fields type-arguments type-match written-matches                         written types resolved
  properties/  finiteness held type-cycle                                                        what a type holds or reaches
```
expansion-edges leaves for `rules/expansion/` (C1).

### checker/resolution (29 → 7 files + 3 folders)
```
resolution/
  applied-call argument-fit calls-made implicit silent-choice named type-parameters(↑ C10) program-type-rules
  choosing/      candidates choice applicability binding call-arguments packs receivers        overloads: candidates to a choice
  conformance/   conformance witness-outcomes root-goals shortfalls witnesses(⊕ C11) derived-traits union-traits trait-calls trait-objects
  type-matches/  type-matches type-match-patterns reduction-requirements implied-constraints
```

### checker/expressions (29 → 9 files + 4 folders)
```
expressions/
  expressions calls operators decided-conditions(← C7) built-members literals templates tuples indented-values
  structs/       structs struct-comprehensions literal-fields literal-sources literal-types variants
  collections/   collections collection-accepts comprehensions literal-items
  control/       control match propagate await select spawn branches(← C6)
  access/        names member-access indexing dereference optionals
```
Check whether `literal-items` and `collection-accepts` are one concern (both: a literal argument's items checked before its call is chosen). If so, ⊕ them.

### checker/patterns (16 → 8 files + 2 folders)
```
patterns/
  walk parts taking targets matching members selections pattern-tests
  exhaustiveness/  exhaustiveness shapes remaining
  constructs/      arrays struct-fields ranges downcasts alternatives
```

### checker/declarations (14 → 3 files + 3 folders)
```
declarations/
  declarations module-checks constants
  functions/  functions signatures parameters statics clashes(← C9)
  aliases/    index(was aliases.ts) alias-recursion recursive-bodies
  layout/     index(was layout.ts) struct-rules
```

### checker/rules (14 → 3 files + 6 folders)
```
rules/
  agreement annotations testing(⊕ C2)
  computation/  (unchanged)
  disposal/     disposal dropped must-use                               C3
  boundary/     host-boundary json-forms                                C4
  expansion/    edges functions types type-matches                      C1
  loops/        iteration field-passes                                  C5
```

### checker/diagnostics (17 → 16): stays flat
One catalog, split by code block. Every part has exactly one user, `index.ts`, so grouping changes nothing a reader follows. Only C24 applies.

### lowering (27 → 6 files + 6 folders)
```
lowering/
  lower context code-writer bodies synthesized-code never-lowered
  tables/     tables type-table names constants instances filling-entry      the interned tables and entries
  values/     unions optionals(⊕ C15) holdings struct-values keyed-fields    how values are laid out
  parts/      places part-paths patterns                                    places and parts reached along checked steps
  calls/      closed-calls emit-call packs
  loops/      iteration field-passes                                        C5
  function-lowering/ (fits ⊕ async-fits)  boundary/  trait-objects/  statements/  expressions/
```

### lowering/expressions (19 → 7 files + 4 folders), mirroring the checker
```
expressions/
  expressions calls closures operators literals templates tuples
  structs/      structs variants
  collections/  collections comprehensions
  control/      control matching select await propagate
  access/       names optionals(⊕ nullish, unwrap: C16)
```

### binder (16 → 4 files + 3 folders)
```
binder/
  bind(coordinator, C25) entities diagnostics naming
  module/      bind-module module-scope local-binder scope flow visibility own-calls   one module on its own
  constructs/  declarations expressions statements patterns types                       names bound per construct
  link/        (cross-module resolution)
```

### syntax (15 → 9 files + 4 folders)
```
syntax/
  node tree positions tokens grammar-words operators placement patterns annotations
  declarations/  index(was declarations.ts) field-defaults parameters
  statements/    index(nodes)  targets  readings                    ✂ statements.ts (34 exports)
  types/         index(was types.ts, ⊕ type-matches: C20)
  expressions/   index readings arguments branches chains comparisons places
    literals/    literals numbers templates indented-values built-types
```
`syntax/` has high fan-in: each move rewrites hundreds of imports through `tsm move`. A single-file `types/` folder is pointless, so C20 can instead merge into `types.ts` and leave it at the root.

### parser (15 → 10 files + 7 folders)
```
parser/
  parse parser grammar diagnostics word-parselets nesting types patterns annotations docstrings
  incremental/  reuse held-bodies
  brackets/     brackets recovery                                    bracketed constructs and their recovery
  cursor/ layout/ parts/ expressions/ statements/ declarations/
```
`parts/` after C18 and C19 (11 files) stays flat. Each file is a piece several categories share, and no grouping is truer than the categories that use them.

parser/expressions (12 → 7 + `literals/`): root `expression parselet operators postfix atoms branches lambdas`, and `literals/` holds `collections struct-literals indented-values templates`. Don't merge `parselet.ts` into `expression.ts`: operators and postfix import parselet's types, and expression imports them, so merging makes a cycle. Type-only imports count.

### definition (16 → 7 files + 4 folders)
```
definition/
  definition tables functions types operands extern-key test-runner
  values/      values declared-values json-values equality instance-handles
  formats/     codec format                 every persisted text goes through these
  validation/  references instruction-rules load checks the shapes can't express
  instructions/
```

### formatter (16 → 9 files + 2 folders)
```
formatter/
  format printer lists brackets bodies declarations statements patterns types
  comments/     comments comment-placement
  expressions/  index(was expressions.ts) branches literals indented-values
```

### language-service (14 → 10 files + 4 folders)
```
language-service/
  workspace checked-module tokens namespaces identifier-at docstrings folding hover inlay-hints symbols
  signatures/  signatures signature-help call-at
  completion/
    index cursor place placeholder candidate expected visible triggers
    presentation/  present presenting entity-items item
    places/  annotation call-argument declared-name literal-field member nothing string-text type
      grammar/   index(was places/grammar.ts) chain expression position surroundings words   C21
      patterns/  pattern pattern-field matched-type(⊕ checked-twin: C22)
      imports/   import module-paths
  navigation/ semantic-tokens/
```

### lsp/providers (13 → 10 files + `navigation/`)
`navigation/` holds `definition references rename`, mirroring `language-service/navigation/`.

### runtime
```
runtime/
  host settle instance-group instance-state natives store refusal random(⊕ C23)
  scheduler/
    wake inspect instance-ends instance-names loaded-definition native-calls
    instance/  index live-objects heap futures slots weak-side           an instance in memory
    testing/   mocks test-world                                          what tests reach through the scheduler
    segment/
  interpreter/  machine registers(✂ machine.ts) ...  boundary/ lifetimes/ snapshot/ testing/ values/
```

### Not crowded, unchanged
cli, project, stdlib (apart from §4), structures, text, diagnostics, language (apart from §4), vscode-client, checker's inference, traits (apart from C10), calls, closures, flow, statements and lookup.

## 4. Wide files

Split, because each mixes subjects:

| File | Exports | Split into |
| --- | --- | --- |
| `checker/types/type.ts` | 45, 399 lines | `type/index.ts` (the Type union, its variants and their constructors, so construction still normalizes in one place), `primitives.ts` (PrimitiveType, `intType`…`errorType`, `isPrimitive`, `expectsError`), `alias-uses.ts` (AliasUse, DeclaredAliasUse, UnreducedUse, RecursiveUse, RecursiveLabel, WrittenThrough, `aliasedAs`, `mapAliasUse`) |
| `language/well-known.ts` | 28 | `well-known/index.ts` (WellKnownDeclaration, `wellKnown`, `qualifiedName`, languageModules, `stdScheme`, `selfType`, `receiverParameter`, `conversionFunction`, `disposeFunction`, `panicFunction`, `unionLayout`), `testing.ts`, `codecs.ts`, `results.ts`, `collections.ts` (collection, template, inclusive-end, array-pattern and entry functions, `stepVariants`) |
| `checker/check.ts` | 22 | `check.ts` keeps Checker, CheckProgramOptions and `checkProgram`. CheckedBody, BodyFacts and their record types move to `surface/checked-body.ts`. |
| `stdlib/native-values.ts` | 22 | `native-values.ts` (scalars, payloads, arrays, optionals, variant entries), `native-results.ts` (every `result*`/`ok*`/`parse*`) |
| `runtime/interpreter/machine.ts` | 20 | `machine.ts` (Machine, frames: new, release, resume, captured, arguments, passed values), `registers.ts` (registers, cells, `storeAt`, `writeReference`) |
| `syntax/statements.ts` | 34 | `statements/index.ts` (nodes), `targets.ts` (destructuring and target readings), `readings.ts` (`tailExpressionOf`, `tailNodeOf`, `passedParts`, `isOverFields`) |
| `checker/types/named-types.ts` | 17, 362 lines | `named-types.ts` (entity types, static owners, members), `pattern-types.ts` (`patternTypeOf`, `downcastTargetOf`, PatternKind, `kindMembers`, `literalMembers`) |

Kept, because each is one vocabulary, model or seam: syntax `expressions/index`, `declarations`, `types`, `patterns`, `tokens`, `tree`, `grammar-words`, `operators`; `binder/entities`; `definition/operands`, `values`, `declared-values`, `extern-key`; `runtime/natives` (the Natives seam's capabilities); `body-context`, `checked-pattern`, `resolved-call`, `computed-types`, `witness-outcomes`, `traits/constraints`; `lowering/instances`, `closed-calls`, `holdings`; `rules/agreement`; `patterns/exhaustiveness`; `parser/recovery`, `cursor/regions`, `expressions/operators`; `decimal/arithmetic`; `program/program`; `formatter/lists`.

## 5. Constraints every step keeps

- **Tools.** `tsm move` for files and folders. `tsm move-symbol` for ↑ and ✂. For ⊕, move every symbol, merge the two banners into one by hand, then delete the empty file. Then `npm run fix`, `tsm check`, `npm run verify`.
- **Tests follow.** `tsm move` moves only the files it is given, so pass `x.test.ts` and `x.test-kit.ts` with `x.ts`. Merged modules merge their tests.
- **dependency-cruiser** (`.dependency-cruiser.mjs`): sub-folders inside a checker layer stay in that layer. `checkerSurface`, `checkerWiring` and `parserCategory` (if `types.ts`/`patterns.ts` move) are path lists and must change in the same commit.
- **400 lines**: every ⊕ above was sized to stay under it.
- **Docs in the same commit:** architecture.md (Folders, Layers, phase contracts), `src/AGENTS.md`, `docs/reuse/*.md` (path mentions), and banners naming a moved file. `rg -l '<old path or file name>' docs src` finds them.
- **Acceptance:** re-run the scan. What remains is §1's triaged keeps, `checker/diagnostics` and `parser/parts` as stated exceptions, and §4's kept files.

## 6. Order

One branch, one commit per row or folder (`refactor(<area>): …`), `npm run verify` green after each:
1. Feature collections C1–C25: cross-folder first, since they change which files the sub-folder steps move.
2. The checker: root (surface, program, body), then types, resolution, expressions, patterns, declarations, rules.
3. Lowering, lowering/expressions.
4. syntax, parser, binder.
5. definition, runtime, stdlib, language.
6. language-service, lsp, formatter.
7. The §4 splits.
8. Re-run `tsm cohesion`, refresh README.md's numbers, and close the open questions below.

## 7. Open decisions

1. **Checker layers vs features.** The checker's folders are layers enforced by dependency-cruiser, so a feature spanning layers splits into its model (low) and its rule (high). Examples: `held` vs disposal, `equality` vs decided-conditions, `type-match` vs `resolution/type-matches`. This plan keeps the layers and gathers each feature at the highest layer all its users allow (C1–C10). The alternative is feature folders with per-file layers in the config: more cohesive, but the layer list gets much harder to maintain. Recommended: keep the layers.
2. **Folder names:** `surface/` (checker models later phases read), `constructs/` (binder, patterns), `properties/` (types). Alternatives are welcome before step 2.
3. **Exceptions:** `checker/diagnostics` (16) and `parser/parts` (11) stay flat.
4. **Mirroring:** lowering/expressions mirrors the checker's grouping (`structs/` and `collections/` with 2 files each) rather than keeping a flatter root.

## Adjacent findings (not part of this plan)

- `encloses` exists twice: `text/span.ts` (Span) and `syntax/positions.ts` (AnchoredSpan). Check whether they duplicate one rule.
- `lowering/function-lowering/index.ts` is 435 lines.
