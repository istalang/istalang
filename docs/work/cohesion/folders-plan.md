---
description: second cohesion pass, on folder shape — every folder at ~10 children (files + folders), loose files beside sub-folders grouped; target trees per area, the layer changes they need, and batch order. Read before regrouping a folder or adding one under checker/, parser/, lowering/, syntax/, language-service/, runtime/ or src/.
owner: toolchain
status: active
applies_to: src/
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [cohesion, folders, refactor]
---

# Folder shape

Scan: `tsm-cohesion-2.txt` (`--all`): 644 files, 319 misplaced exports, 2 crowded folders, 44 wide files.
tsm's crowded rule counts files only. This pass also counts sub-folders, and flags folders mixing
sub-folders with loose files (proposed to tsm as a rule).

## Rules

- At most ~10 children (files plus sub-folders) per folder. `stdlib/` is exempt: one folder per std module.
- A folder with sub-folders keeps only its entry, its contracts and peers of its sub-folders (a construct
  small enough to be one file, beside constructs that are folders). Everything else goes into a sub-folder.
- Group by semantics. Inside the checker, a group is a contiguous run of layers, so it is itself a layer.

## Census before → after

| Folder | Before (files + dirs) | After |
|---|---|---|
| `src/` | 0 + 14 | 0 + 9 |
| `compiler/checker/` | 5 + 17 | 1 + 9 |
| `checker/types/` | 8 + 7 | 0 + 9 |
| `checker/expressions/` | 10 + 4 | 2 + 6 |
| `checker/resolution/` | 8 + 3 | 0 + 5 |
| `checker/diagnostics/` | 16 + 0 | 9 + 0 |
| `checker/patterns/` | 8 + 2 | 2 + 2 |
| `compiler/parser/` | 10 + 8 | 3 + 4 |
| `parser/parts/` | 11 + 0 | 10 + 0 |
| `compiler/lowering/` | 6 + 10 | 2 + 6 |
| `lowering/expressions/` | 7 + 4 | 4 + 5 |
| `compiler/syntax/` | 9 + 4 | 2 + 6 |
| `language-service/` | 10 + 4 | 3 + 6 |
| `completion/places/` | 8 + 3 | 7 + 3 |
| `lsp/providers/` | 10 + 1 | 8 + 2 |
| `formatter/` | 9 + 2 | 6 + 3 |
| `definition/` | 7 + 4 | 3 + 5 |
| `runtime/` | 8 + 7 | 4 + 7 |
| `runtime/scheduler/` | 6 + 3 | 3 + 3 |

## src/

```
src/
  foundation/      text/ diagnostics/ structures/ language/   the layers every phase builds on
  compiler/
  definition/
  runtime/
  stdlib/
  formatter/
  editor/          language-service/ lsp/ vscode-client/     editor support: features, protocol server, client
  project/
  cli/
```

Outside src: `package.json` exports (`dist/runtime/host.js` moves with runtime/host/), `tsdown.config.ts`,
`biome.jsonc`, `scripts/profile/`, tests importing these paths, `.dependency-cruiser.mjs` layer keys
(`foundation/text`, `editor/lsp`, …; `foundation` list, `nodeLayers`, `vscode-client`'s
`lsp/std-source-request`).

## compiler/checker/

Groups follow the layers. Two changes make every group contiguous: `rules/loops/` (iteration and field passes,
used only by `for` and comprehensions) is a construct, so it moves up into `constructs/`. That leaves `rules/`
importing nothing in `patterns/`, so `rules/` drops below `patterns/`. New order:
diagnostics < types (model < inference < traits) < resolution (… < calls) < rules (flow < rules) < constructs
(patterns < loops < declarations < closures < expressions < statements) < lookup.

```
checker/
  check.ts
  contexts/        context.ts body-context.ts passes.ts use-site.ts         the contracts every folder reads
  surface/         unchanged (10)
  diagnostics/     index generics values collections patterns closures concurrency lifetimes boundary
  types/
    type/          index primitives alias-uses + computed-types function-types field-order
                   struct-constraint well-known type-rules type-text        the type model (10)
    parts/         type-parts type-children computed-reduction + substitution
    identity/ unions/ fitting/ properties/                                   unchanged
    written/       named-types absorbs resolution/named.ts (one concern: what a name in value position names)
    inference/     ← checker/inference/
    traits/        ← checker/traits/
  resolution/
    choosing/      + calls-made.ts (the output of choice; choosing and conformance already import each other)
    conformance/   unchanged (10)
    type-matches/  unchanged
    applying/      applied-call argument-fit implicit silent-choice          a chosen call applied: written, by the language, by the toolchain
    calls/         ← checker/calls/ (a call in a body)
  rules/
    flow/          ← checker/flow/ (only rules import it)
    agreement.ts annotations.ts testing.ts boundary/ computation/ disposal/ expansion/
  constructs/
    patterns/      matching.ts targets.ts exhaustiveness/
                   walk/  index (walk.ts) parts pattern-tests taking selections members kinds/ (← constructs/)
    loops/         ← rules/loops/
    declarations/  + type-parameters.ts (← resolution/; type parameters as declared, used by module-checks and program-checker)
    closures/ statements/                                                    unchanged
    expressions/   expressions.ts calls.ts access/ collections/ control/ structs/
                   operators/  operators decided-conditions
                   literals/   literals templates tuples indented-values literal-items built-members
  lookup/          unchanged
  wiring/
    program/       program-checker program-inputs + program-type-rules (← resolution/; only program-checker uses it)
    body/          ← checker/body/
```

Diagnostics merges (one catalog, parts by code family): `generics.ts` takes packs, keys, type-matches,
trait-objects and spelling (5080–5199, ~330 lines); `values.ts` takes templates; `boundary.ts` takes testing
(5900–5999).

`.dependency-cruiser.mjs`: `checkerLayers` become nested paths (an upper sub-layer excludes the lower one:
`rules/(?!flow/)`); `checkerContracts` = `check.ts`, `contexts/`, `surface/`; `checkerWiring` = `wiring/`;
`checkerModel` = diagnostics and the type model without `inference/` and `traits/`; `checkerSurface` paths.

## compiler/parser/

```
parser/
  parse.ts parser.ts diagnostics.ts
  cursor/          index regions + brackets recovery (← brackets/; cursor and brackets import each other)
  layout/          index bodies continuations item-breaks + annotations docstrings (what stands before an item; layout already imports both)
  incremental/     unchanged
  grammar/         index (← grammar.ts) nesting word-parselets patterns.ts types.ts
                   expressions/ statements/ declarations/ parts/
```

`parts/`: `blocks.ts` absorbs `items.ts` (a block's items). `parserCategory` and the parts rule move under
`grammar/`.

## compiler/syntax/

```
syntax/
  tokens/          index (← tokens.ts) grammar-words
  tree/            index (← tree.ts) node positions
  items.ts         placement.ts + annotations.ts (where an item stands, what it carries)
  patterns.ts
  declarations/ statements/ types/
  expressions/     + operators.ts
```

## compiler/lowering/

```
lowering/
  lower.ts context.ts
  functions/       index (← function-lowering/index) fits frames + code-writer bodies   writing one function
  tables/          unchanged
  synthesized/     index (← synthesized-code.ts) trait-objects.ts (← trait-objects/) boundary/   code with no syntax behind it
  constructs/      expressions/ statements/ loops/ parts/ never-lowered.ts               mirrors checker/constructs/
  calls/ values/   unchanged
```

`constructs/expressions/`: `literals/` = literals templates tuples (mirrors the checker's).

## language-service/, lsp/, formatter/

```
language-service/
  workspace.ts hover.ts inlay-hints.ts
  reading/         checked-module identifier-at tokens namespaces docstrings   what features read of a module at a spot
  outline/         symbols folding
  completion/ navigation/ semantic-tokens/ signatures/
```

- `completion/places/nothing.ts` (`() => []`) folds into the provider table in `completion/index.ts`.
- `lsp/providers/outline/`: document-symbols, folding-ranges (mirrors language-service).
- `formatter/layout/`: bodies, brackets, lists. Construct printers stay peers of `expressions/`.

## definition/, runtime/

```
definition/
  definition.ts operands.ts extern-key.ts
  tables/          index (← tables.ts) functions types test-runner
  formats/ instructions/ validation/ values/

runtime/
  natives.ts store.ts instance-state.ts refusal.ts                   contracts inner modules and hosts read
  host/            index (← host.ts) instance-group settle            driving instances from a host
  interpreter/     + parts.ts (← values/)
  snapshot/        + random.ts (snapshot reads it; scheduler/ can't hold it, snapshot sits beneath)
  scheduler/       wake inspect loaded-definition
                   instance/ + instance-names instance-ends;  segment/ + native-calls
  boundary/ lifetimes/ testing/
```

The four contracts stay at the root (11 children): inside host/ they would make host/ and scheduler/
import each other.

## Order

Serial batches, each verified with typecheck, lint, depcruise, knip and test:std:

1. Checker groups: contexts/, wiring/, rules/flow, constructs/, types/{inference,traits}, resolution/calls,
   dependency-cruiser.
2. Checker inside: types/ loose files, resolution/ loose files, patterns/walk, expressions/, diagnostics
   merges, named.ts into named-types.ts.
3. Parser and syntax.
4. Lowering.
5. Language service, LSP, formatter, definition, runtime.
6. `src/` root (foundation/, editor/, package exports, build config).
7. Docs (architecture.md's folder map) and the after-scan.

## Left as is

- 44 wide files: unchanged from the first pass; `type-parts.ts`, `unions.ts`, `patterns/parts.ts`,
  `candidates.ts` and `expected.ts` are still untriaged.
- `binder/module/flow.ts` belongs in `binder/constructs/` (first pass's leftover).
- `completion/` root stays at 10.
