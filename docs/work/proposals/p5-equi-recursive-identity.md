---
description: plan for making proposal 5's recursive aliases equi-recursive (two recursive types with one structure are one type) — the human's decision and why, the evidence from the form builder, why a canonical key alone can't do it, the one-constructor route (recursive types carrying a minimized cyclic graph), what it deletes, files, tests, docs to rewrite, and the steps left to ship proposal 5; read before implementing or reviewing equi-recursive identity
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-06
last_updated: 2026-11-06
tags: [plan, proposals, types, recursion, identity, p5]
---

# Proposal 5: equi-recursive identity

Proposal 5 (`docs/proposals/5-indented-values.md`, Rule 2) shipped recursive aliases iso-recursive: a use is keyed by its alias and arguments, so two aliases with equal bodies are two types. The human decided (2026-11-06) to make them **equi-recursive** before P5 merges: two recursive types with the same structure are one type. Nominal `struct`s and `enum`s stay nominal. This file holds everything needed to implement it without re-researching.

## Decisions (the human's, 2026-11-06)

1. **Equi-recursive identity** for recursive aliases whose bodies are shapes, unions, tuples, functions or declared types with arguments. `type FormCategory = { name: String, children: Array<FormCategory> }` and `type CrmCategory = { name: String, children: Array<CrmCategory> }` are one type; `type Tree = Int | Array<Tree>` and `type Forest = Tree | Array<Forest>` are one type.
2. **The P5 rules this reverses, all accepted:**
   - A recursive alias standing in a union is **flattened**: its members join the enclosing union (P5 said "a use stands as one member, never flattened").
   - A written `Int | Array<Tree>` **is** `Tree`.
   - `x is Tree` on a `Tree | String` tests `Tree`'s members.
   - Tests asserting that equal-bodied aliases are distinct flip.
3. **Persisted names: structural identity, alias as label.** A compiled program's type entries and snapshots are identified by the type's canonical structural spelling, stable across deploys and unaffected by adding or renaming aliases. A readable alias name is kept beside it as a display label that identifies nothing, chosen deterministically: a std module's alias first, then by module path, then by name. Extern keys keep the alias written in the extern's own signature, so `json.Json` stays.
4. **Process:** the human asked for this document first, then the implementation. Run it in its own worktree branch off `p5-indented` (suggested `p5-equi`), so a half-migrated tree never blocks the P5 branch; merge back when `npm run verify` is green and review and QA pass.

## Why (evidence)

Run on the built CLI at `cd7d4af0`:

```python
type FormOrder = { note: String?, qty: Int }
type CrmOrder = { note: String?, qty: Int }
fn save(o: CrmOrder) -> Int: o.qty
type FormCategory = { name: String, children: Array<FormCategory> }
type CrmCategory = { name: String, children: Array<CrmCategory> }
fn saveTree(c: CrmCategory) -> Int: c.children.length()
# save(o) with o: FormOrder checks; saveTree(c) with c: FormCategory is error 5001
```

- **The form builder depends on structural shapes** (P2: "a shape is one type wherever written", §3.1). Generated modules compute each form's data type (`type OrderData = Group<OrderModel>.Data`, `examples/FormBuilder/order.gen.ista`), and domain modules write the shape they consume by hand (`examples/FormBuilder/crm.ista`: `type Order = { note: String? }`). Form data flows into domain functions with no conversion.
- **Iso-recursion breaks that bridge as soon as data is recursive**: the supplier form's category tree (`CategoryModel` with `children: List<Group<CategoryModel>>`, `supplier.gen.ista`) computes a `.Data` that is no `Category` a domain module declares. One self-reference turns a structural shape nominal.
- **Where it arises:** form data into domain modules (category trees, org charts, nested comments, menus); generated code (each `.gen.ista` emits its own types; a form embedding another); versioned catalog packages (`catalog/contact-card@^1.ista` and a later version); conditional logic stored as data (and/or/not trees decoded in one module, evaluated in another); rich-text documents and schema-like field trees; extending a library alias (`type Fields = Field | Array<Fields>`, then `type Section = Fields | Array<Section>`).
- **The ambiguity QA found** disappears: with `Forest = Tree | Array<Forest>`, `const b: Forest = [1]` fits two members today (error 5001; spec §2 says a literal builds "the one member it fits"). The two builds are different values today: a `match` over `case Tree` / `case Array<Forest>` printed `Tree / Array<Forest> / equal: false` (scratch repro `forest.ista`). Equi-recursively, `Forest` normalizes to `Int | Array<Forest>`, one array member.
- **Where it doesn't help:** structs and enums stay nominal by design (the form builder's models, `Node`, `Prop`); `Json` is one std alias; the 5134 conformance failure was conformance, solved by `7a743115` (coinduction).

## The iso-recursive representation it replaced, with its homes

- `RecursiveUse` (`checker/types/type.ts`): `{declaration, arguments}`. `RecursiveType` (`checker/types/computed-types.ts`): `{kind: 'recursive', declaration, arguments}` plus `WrittenThrough`. It holds no structure.
- **Unfolding is checker state**: `TypeRules.unfold` / `unfoldedMembers` (`checker/types/type-rules.ts`, implemented in `checker/declarations/aliases.ts` through the `#unfoldings` entries table keyed by `typeKeys.spelledKey`, and `checker/resolution/program-type-rules.ts`). `unfolded(type, rules)` (`type-rules.ts`) is the reader.
- **Identity markers**: every unfolded body carries its use (`Unfolding.recursion`, `withRecursion` in `computed-types.ts`; `isUnfoldable`, `recursionOf` in `type.ts`) so `typeKey(unfold(use)) === typeKey(use)` (fix `f8b3558d`). `MappedType.recursion` (`computed-types.ts`, from `7a743115`) does the same for a type `match` reduced while its subject was opaque.
- **Keys**: `checker/types/identity/type-keys.ts`. Identity is key equality (`identity.ts`). A recursive use keys as `{~<declaration identity number><args>}` (`recursionKeyOf`); the whole key of a type object is memoized in the `ownKeys` WeakMap, across every checker and revision. The banner states the contract: keys are pure functions of an immutable type object.
- **Unions**: `checker/types/unions/unions.ts`. `unionOf` → `memberTypesOf` keeps a recursive use as one member; `withoutHeld` drops members a recursive member's union already holds; `holdingMember` / `holds` find, at any depth, the recursive member holding a value (fix `19baf9b4`). Readers: `fit.ts` (`membersTaking`), `named-types.ts`, `patterns/members.ts`, `rules/computation/forms.ts` (`memberForm`, fix `b8f2b5e2`), `lowering/holdings.ts` (`holdingOf`, `heldIn`, `heldPositions`, `branchOnHeld`, `inRecursive` nested holding).
- **Guard and regularity**: `checker/declarations/alias-recursion.ts` decides from the body's syntax which aliases recurse only in guarded positions (type argument, shape field, tuple element, function parameter/result); 5106 unguarded, 5128 `irregularAlias` (`checker/diagnostics/generics.ts`). These stay: equi-recursion needs regular, guarded aliases to have finite graphs.
- **Finiteness**: `checker/types/finiteness.ts` (5211) walks every body kind.
- **Expected-type destructors** unfold: `builtFrom`, `expectedTuple`, `expectedFunction`, `collectionTarget`, `takingUnfolded` (`checker/types/fitting/expected.ts`); `presentType` (`unions.ts`); `aliasedShape` (`expressions/literal-types.ts`, `expressions/indented-values.ts`).
- **Lowering type table**: `lowering/type-table.ts`. A recursive use is the entry of what it unfolds to (a union's enum named for the alias, e.g. `json.Json` with role `json`; a shape's struct), and a tuple- or function-bodied one gets an `alias` entry (`#aliasEntry`; `definition/types.ts` `kind: 'alias'`; `docs/arch/definition.md`).
- **P4's recursive type `match`** (`checker/resolution/type-matches.ts`, `match-requirements.ts`) keys a reduction by its match use (`useKeyOf` in `type-keys.ts`, `match:<id><args>`).

## Why a canonical key alone can't do it (the first hypothesis, refuted)

The first hypothesis was: since every consumer reads identity through `typeKey`, make the key of a recursive use canonical (minimized graph) at its constructor, and everything else follows. It fails for three reasons:

1. **Keys must stay pure per type object.** A recursive use holds only `{declaration, arguments}`; its structure lives in the checker (`#unfoldings`). A canonical key would depend on other declarations' bodies, which can't be memoized per object, and type objects are reused across revisions: editing `Tree`'s body would leave `Forest`'s memoized key stale.
2. **It is circular.** An alias's body is resolved through `unionOf`, which dedupes members by key; those members contain the alias's own use, so a canonical key at construction needs the body being built.
3. **Equal keys need equal layouts.** Lowering lays a union out by its members. `Forest` and `Tree` can share a key only if their unions have the same members, so unions must flatten recursive members, which reverses P5's "never flattened".

## The route: one constructor, recursive types carrying their own structure

- **Representation.** A recursive type becomes `{kind: 'recursive', graph, node, alias}`: a node of an immutable, minimized cyclic graph whose nodes are ordinary types (union, shape, tuple, function, nominal with arguments) with back-references to nodes of the same graph. `alias` is display only (the alias written, for messages and hovers). Unfolding is pure: `graph.nodes[node]`, with back-references resolved to recursive types of the same graph. Keys stay pure functions of the object; nothing reads the checker to unfold.
- **One constructor builds every recursive type: `closeRecursive`.** Input: a group's bodies (an alias, or a strongly connected group of mutually recursive aliases), each resolved with opaque placeholders standing for the group's self-uses (this breaks the circularity of point 2). It:
  1. builds the graph (one node per distinct subterm reached, back-edges at placeholders);
  2. flattens unions: a union node's member that is a union node, or a back-reference to one, contributes its members;
  3. minimizes by partition refinement (Hopcroft-style), with a local union-find (Hopcroft–Karp) to merge equivalent nodes; a union node's signature is the **set** of its members' classes (unordered, deduped), other nodes' signatures are their kind, their non-type data (field names, nominal entity, arity, literal values) and the ordered classes of their children;
  4. rebuilds canonical nodes with deduped unions and chooses a canonical root numbering (deterministic traversal order).
  All recursive types go through it: alias groups, mutual recursion, substitution into a generic recursive type (substitute, then re-close, so canonicalize-then-substitute equals substitute-then-canonicalize by construction), and P4's recursive type `match` reductions (stage 2), giving one identity rule.
- **Keys.** A recursive type's key is the canonical spelling of its graph with `~k` back-references. A type containing recursive references (a written `Int | Array<Tree>`, a tuple holding a `Tree`) is keyed by canonicalizing its whole graph, so it keys as `Tree` does. Pure, memoized per object in `ownKeys`. `spelledKey` keeps the written alias for spelling-sensitive memos.
- **Unions.** `unionOf` flattens a recursive member whose node is a union. `Json | Int`, `Json?`, `Tree | Int` and `Tree | Array<Forest>` collapse by plain dedupe. When the result's key equals a recursive member's key, `unionOf` returns that member, so the alias keeps printing.
- **Display.** Messages and hovers print the alias written (`alias` on the type, or `WrittenThrough`), never the canonical spelling; a type with no alias prints its structure.
- **Persisted spellings** (decision 3): lowering's type-table entry for a recursive type is identified by the canonical structural key and labelled by the preferred alias (std first, then module path, then name). Extern keys spell the alias written in the extern's signature.

### What it deletes

- `withoutHeld`, `holdingMember`, `holds` (`unions.ts`) and their readers in `fit.ts` (`membersTaking`), `named-types.ts`, `patterns/members.ts`, `rules/computation/forms.ts` (`memberForm`'s recursive wrap).
- Lowering's nested holding: `inRecursive` and its branches in `holdings.ts` (`holdingOf`, `heldIn`, `heldPositions`, `branchOnHeld`). A flattened union holds its members directly.
- The identity markers: `Unfolding.recursion`, `withRecursion`, `isUnfoldable`'s use for identity, `recursionOf` on five kinds (`type.ts`, `computed-types.ts`), and their readers in `type-keys.ts`, `type-parts.ts` (`rebuiltBy`, `mapParts`), `type-text.ts`, `substitution.ts`, `named-types.ts`, `type-table.ts`, `alias-recursion.ts`, `type-matches.ts`.
- `TypeRules.unfold` / `unfoldedMembers` as checker state, and the `#unfoldings` entries table (`aliases.ts`, `program-type-rules.ts`, `type-rules.test-kit.ts`): unfolding becomes `graph.nodes[node]`. `unfolded(type, rules)` keeps its signature or loses `rules`.
- `MappedType.recursion` (from `7a743115`), subsumed by stage 2.
- Estimate from the scouting fork: about 250 new lines (the canonicalizer) against about 110 reference lines deleted or simplified across about 24 files; most references in `type-matches.ts` (11), `holdings.ts` (14), `unions.ts` (11), `type-parts.ts` (8), `type-table.ts` (6).

### Stages

1. **Stage 1:** the graph representation, `closeRecursive` for aliases (single and mutual, generic via re-closing), canonical keys, union flattening and the alias-returning `unionOf`, display labels, the type-table entry by canonical key with alias label, and every deletion above except `MappedType.recursion`.
2. **Stage 2:** P4's recursive type `match` reductions built through `closeRecursive`, removing `MappedType.recursion` and the `match:` use key where a reduction recurses. Done: a recursive use closes with every recursive use its finding reached, the bodies reduced with those uses as unreduced `match` placeholders; the `recursiveMatch` kind, `AnonymousStructType.recursion`, `MappedType.recursion` and `TypeRules.unfold` are gone, `unfolded` moved to `computed-types.ts`, and a use whose values would hold themselves is the error type carrying `holdsItself`. Once a group closes, the computed types its nodes hold are reduced over the closed nodes and the group closes again, so a type `match` applied to the group's own use (`Wrap<A<D>>` in `A`'s case) reduces too.

### Outcome (decided while implementing; reviewed)

- **Bodies resolve twice.** Each group's bodies are resolved a second time with placeholders for the group's uses (`declarations/recursive-bodies.ts`), apart from the checker's own resolution, since resolving in place would be circular.
- **Guards are derived from declarations.** Whether a type argument is a guarded place comes from the declaration it is passed to: a nominal type's argument is guarded; an alias's argument only where every use of its parameter is; a match alias's argument must be known first when a case pattern inspects it. `any Trait<A>` is guarded. `keyof A`, `A["k"]` and `A.Data` stay 5106, as before. `type R = Int | Array<R?>` now works.
- **Union rules have one home** (`types/unions/union-members.ts`), used by `unionOf` and the graph. Refinement reads a union as the set of its members' classes; only nodes on a cycle become graph nodes. No union-find is needed.
- **Recursive matching.** `matchCase` and inference match a recursive type through its unfolding, under one coinductive pair rule (`types/identity/unfolding-pairs.ts`). A known subject always reduces or fails. Structurally equal match results are one type (`T1<String>` is `T1<Int>` when they build the same structure).
- **Labels.** A recursive type's label is the alias or associated-type use as written (`Group<CategoryModel>.Data`), and `typeText` is the one spelling. Lowering labels a type-table entry by the preferred alias among every alias, generic ones included, that closes to its key. Spelled keys spell a graph by its nodes and labels, so incremental checking reuses dependents of `Tree<Int>`.
- **B32.** A non-`match` associated type reaching itself through instantiations is error 5136 (cause `expandsItself`), found by `resolution/reduction-requirements.ts` (formerly `match-requirements.ts`) at every instantiation, written or inferred, and reported per instantiation site. Every associated type on the cycle is the error type, and a type parameter only the error type met binds to it, so nothing reports twice.

The intermediate states don't pass verify, and the work exceeds one fork session (forks stop at 200 turns; resume them with a message). Hence the separate worktree branch.

## Tests

Red-first, beside the code (`checker/types/`), fast-check:
- **Identity property:** `typeKey(a) === typeKey(b)` exactly when a reference bisimulation checker, written in the test, says two generated recursive types are equal: shapes, unions, tuples, functions, declared types with arguments, generic instantiations, mutual recursion, aliases through other aliases.
- **Commutation:** canonicalize-then-substitute equals substitute-then-canonicalize over generated generic aliases and arguments.
- **Cases that must check and run:** `saveTree(c)` with `c: FormCategory` against `CrmCategory`; `const b: Forest = [1]` and `[1, [2]]`; `Json | Int` and `Json?` are `Json`; `x is Tree` on `Tree | String` selects `Tree`'s members; Json still crosses the host boundary as plain values (`definition/json-values.ts`, `lowering/boundary/`).
- **Kept refusals:** 5106 (unguarded), 5128 (irregular), 5211 (infinite).
- **Persisted spelling:** the type table names the same canonical entry whichever alias was written, with the preferred alias as label; adding an alias in another module changes no entry's identity.
- **Tests that flip** (equal-bodied aliases distinct, absorption and nested-holding layouts): `checker/declarations/recursive-aliases.test.ts`, `checker/types/identity/recursive-holdings.test.ts`, `checker/types/identity/recursive-unfolding.test.ts` (identity cases), `checker/types/identity/recursive-uses.test.ts` where it asserts iso layout. Keep their value-level cases (literals at any depth, constants, arguments, spreads).

## Docs to rewrite in the same commits

- `docs/proposals/5-indented-values.md`: Rule 2's **Identity** bullets (identity is structural; display keeps the alias), **In a union** (flattened), **Why not equi-recursive** becomes this decision and its route, the behaviour rows for recursive aliases, **Not gained** (drop "equi-recursive identity"), implementation note 6, and §14's future-work item.
- `docs/spec.md`: §2 Unions (a recursive alias's members join the union), §3.1 recursive types, §3.17 (identity of recursive aliases), §14 (drop equi-recursive from future work).
- `docs/reuse/types-and-fitting.md` (the constructor, keys, union flattening; drop `holdingMember`/`recursionOf` lines), `docs/reuse/lowering-and-ir.md` (no nested holding), `docs/arch/architecture.md` (types/ line), `docs/arch/definition.md` (recursive entries by canonical key with alias label; the `alias` entry).

## Proposal 5's state and the steps left to ship it

- **Branch** `p5-indented`, worktree `.claude/worktrees/p5-indented`, from main `538e35d5`; head `cd7d4af0` before this plan's commit. Commits: Rules 4, 6, 7, 1 (+ audit unit 29), coinductive conformance (`7a743115`), Rules 2+3 (+ audit units 5, 28), Rule 5, the review and QA fixes, and the human's docs commit (`ffa793f6`, proposals 6–8 and `docs/review/guessed-forms.md`).
- **Review approved** at `cd7d4af0` (all 11 findings and residuals). **QA passed** every finding; its one open item, the `Forest = [1]` ambiguity, is what this plan resolves.
- **Since:** `p5-indented` is rebased onto main with the form builder (its generator emits `,` and parameter patterns; tracker F23 is fixed by the coinductive conformance), and the formatter keeps an end-of-line comment on a block's last item. Stages 1–2, B32 and the review fixes are on `p5-equi`; QA passed it.
- **Left, in order:** the reviewer's approval of `p5-equi`; merge it into `p5-indented`; present the result to the human and wait for approval (no merge before it); then rebase on main, `npm run verify`, `git -C /Users/arash/Projects/istalang merge --ff-only p5-indented`; add a Proposal 5 milestone row to `docs/work/tracker.md`, close F23 and B32, and file the debt below; report to the coordinator.
- **Debt to file at merge** (tracker): Q42 gains the body fact `builtLiteralOf` (five declarations); audit unit 8's `bodiesHeldBy` reflection walk costs 14–17% of parse time; B8 (a map spread's values fit only exactly) is now common with `Json` (`["k": 1, ...m()]` against `Json` fails); field completion inside a destructuring `const` pattern has no step; an async lambda passed where `fn(A) -> Future<R>` is expected reports a misleading second error in its body; a top-level `const` holding a variant is refused (5026, with B13); B21 completion timeouts recur under load; the rename property in `lsp/providers/rename.test.ts` fails at seed -420107366, path "24" (renaming `Some` declared in `generics/default-typed-fields.ista` spills into `unions/invalid-matching.ista`), already before equi; `examples/FormBuilder/generate.ts` doesn't run under Node type stripping (its CLI block is CommonJS). F17 stays open (not the argument-literal case).
