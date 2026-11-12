---
description: plan for static lifetimes — process, five checker phases (C1 flow IR and witness closing, C2 annotations, C3 the analysis, C4 its refinements, C5 lowering on the IR) and five runtime phases (R1 edges and oracle, R2 seams and identity, R3 counting, R4 only indexes, R5 in-place values), with scope, acceptance, order, shared surfaces and diagnostic ranges; read before forking, planning or examining a static-lifetimes phase
owner: tech-lead
status: proposed
applies_to: istalang
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [plan, lifetimes, disposal, checker, flow, runtime, refcount]
---

# Static lifetimes — plan

Design: `design.md`, whose §14 holds the human's decisions. Code tours, one per lane:
`tour-checker.md` and `tour-runtime.md`. Each phase's planner starts from its lane's tour. Spec:
`docs/spec.md` §3.16, §5, §6, §7.

## Process

**Ten phases in two lanes.** Each phase is an implementer fork in its own worktree, reviewed by a
cold Claude `reviewer` over hcom. Behavioural phases also get a qa.

*Why ten:* a phase is something that merges on its own, is days of work, and is reviewed as a
whole. Everything smaller rides inside the phase that needs it, as its own commits:
- witness closing rides with the IR, since both are behaviour-neutral moves of what the analysis
  reads;
- related diagnostics, the rewrites and the editor budget ride with the analysis, so the rule never
  lands without its fixes;
- shadow counts and order ride with the switch to counting.

- **Merging:** a fork rebases and fast-forwards `main` once its reviewer, and its qa where there is
  one, approve.
- **Profiles:** checker phases run `npm run profile:check` and `edit.bench.ts`, runtime phases
  `wake.bench.ts`, against their base. Both must stay within noise unless the phase says otherwise.
- **Each phase** edits:
  - the spec sections it changes (`design.md` §11);
  - the docs it touches (`architecture.md`'s trees included);
  - its lane's tour, where its code moved;
  - its tracker rows.

  Its acceptance names every corpus diagnostic it moves; nothing else moves.

## Checker lane

| Phase | Scope | Accept |
|---|---|---|
| **C1** Flow IR and witness closing (structural; reviewer only) | 1. The closing algorithm moves from `lowering/calls/closed-calls.ts` onto the checker's surface, and lowering reads it there (`tour-checker.md`, Witness closing). 2. The IR of `design.md` §4 per checked body, in `rules/flow/`, memoized on the body. `dropped.ts` reads it, and `forward.ts` is deleted; `data-kinds.ts` stays a tree walk, its order being the text's (decided 2026-11-12). `architecture.md` names the IR's contract | No behaviour change. Every Definition byte-identical on the corpus, the spec's fences and the std. Every `dropped`, `data-kinds` and `kinds` test unchanged. Exhaustive tables per kind of node, and a sweep: every expression checking typed has an IR value at its node, every made call, implicit ones included, is an IR call. Profile within noise |
| **C2** Generic annotations, `Holds` and `Keeps` (behavioural) | `design.md` §6. Parser: `@Name<Types>`, with or without `{…}`. §3.1's bare form with type arguments. A declaration's annotations bound and checked in its type-parameter scope. Struct and extern struct declarations as places. The `lifetimes` std module. `heldPartsOf` reading `Holds`, `keepsOf(extern)`, their misuse, and parameter names as denotations. The prelude and std annotated. The readers of `heldPartsOf` audited | `@Holds<()>` on `WeakRef`: `WeakRef<Future<…>>` holds nothing for sendability and must-use. `@Keeps{["self": ["nope"]]}` is an error, and so is either annotation outside the std. Go-to on `"value"` reaches the parameter |
| **C3** The analysis, on (behavioural; the largest) | In this order: 0. The native audit (`design.md` §6.6), reading `keepsOf` and `Holds`: it needs R1's edges, since today's `onAwait` adds a resolver → future edge no `Keeps` covers. 1. Related locations on `Diagnostic`, published by the LSP and printed by the CLI. 2. `design.md` §5.1–5.5 as a dry run: relevance and `reachesDisposable`; the domain over the IR, with field labels and the plain-function seam prepared (§5.6), and §5.7's per-field input paths; summaries, requirements (separation ones too, §5.5) and call reach; symbolic requirement calls through C1's closing; `any` and function values; natives from C2; the declaration graph; escaping closures and runtime-run code. Every result an entry. 3. The `counted` flag on the Definition's type entries. 4. The rewrites §10 lists, and whatever else the dry run finds that is a real cycle. 5. The diagnostics on, with `test/corpus/lifetimes/` (§12). 6. The editor's budget, and a cold-open bench | The native audit passes over the std suites and the corpus, and fails when an entry is removed from `put`'s `Keeps`. §12's corpus passes. The std, `test/examples.test.ts`, the spec's fences and the runtime tests' programs report nothing outside the invalid cases, but FormBuilder, `it.fails` until C4 (decided 2026-11-12). A property over fragment soups (writes, closures, async calls, inboxes, awaitables): an accepted program never trips R1's oracle when run. A commute property: a generic call's verdict equals its instantiated copy's. "Incremental equals fresh" covers the new diagnostics. The median warm edit of `edit.bench.ts` on the 2,098-line module adds ≤ 2 ms. The dry run's false positives are listed in `findings.md` |
| **C4** What closures capture, and field labels (behavioural; right after C3) | `design.md` §5.6, and of §5.7 what C3 left, through C3's prepared seam and labels: per-module entries of what escaping closures capture; labelled pairs, reads through one field, and strong updates on fields | The false positives `findings.md` lists for both pass: an escaped plain function written after an `await`, and relinking (`node->next = other`) after unlinking. FormBuilder checks clean, its `it.fails` removed. No rejection of §12 moves. The cold open within 20% of C3's baseline; the warm edit budget holds |
| **C5** Lowering on the IR (structural, then behavioural) | Lowering reads the flow IR instead of the checked syntax for where values go. Then the retain/release pairs the IR shows to be redundant are elided | Definitions byte-identical before elision on the corpus and std. After elision, every test passes and the oracle stays silent. `wake.bench.ts` faster on R3's fixture |

## Runtime lane

| Phase | Scope | Accept |
|---|---|---|
| **R1** Edges and the oracle (behavioural) | Registration edges by the chain's root, and `disposeFuture` cancelling what is registered on the future (`tour-runtime.md`, R1). The test-only oracle (`design.md` §9.2) | The spec examples, `test/corpus/holders/` and `weak-side/`, the std suites and the resolver tests give the same outcomes. The oracle passes over all of them, except the cases C3 turns invalid, which it flags. `wake.bench.ts` within noise |
| **R2** Seams and identity (structural; reviewer only) | One seam for every holder write (`tour-runtime.md`, R2). A counted handle's identity off the id heap: a serial keeping creation order, never reused. `asHostValue` and `leaving` become one walk. Q51 settled | No behaviour change. Creation order is unchanged for `Heap.find`, `settleOrder`, losers and `reachingMock`. A dependency-cruiser rule lets only the seam import the raw writers |
| **R3** Counting (behavioural) | In this order: 1. Shadow counts beside tracing, keyed by R2's identity, rebuilt in the `Instance` constructor, counting what `design.md` §9.1 says, from C3's `counted` flag. 2. The switch: counts decide disposal; the orphan search, release noting and `#kept`'s scan go; zeroes are confirmed at the step's end. 3. Order under counts, against every place order is decided today (`tour-runtime.md`, R3) | The shadow check passes over the runners before the switch. After it, the full suite and corpus pass in the same disposal order, including the order tests `tour-runtime.md` lists. A `let f = fn: f()` case is an orphan that never reaches zero. `wake.bench.ts` shows collection cost below tracing on a release-heavy fixture. FormBuilder's live change gets closer to the 26 ms ceiling from 48 ms, measured once C4 lands, since FormBuilder compiles only then |
| **R4** Only indexes (behavioural) | The heap keeps indexes, and live paths hold objects directly. The commit walks once, for objects and depth. A weak reference is kept alive by its referent (`tour-runtime.md`, R4) | Live paths can't import a walk (dependency-cruiser). An uncounted cell is reclaimed (a finalization test). Commits are byte-identical |
| **R5** Unique values in place (behavioural) | Every composite node counted. A node held once and made by this instance is updated in place; any other is copied at its first write (`design.md` §9.6) | P2's figures (20k-element comprehension, 5k map inserts, `[...0..20000]`) become linear. Constants and restored values are never written: a property over two restores of one snapshot. `wake.bench.ts` not slower beyond noise |

## Order

- **C1, C2 and R1** start together, since they touch disjoint layers.
- **C3** needs all three: the IR and closing, the externs' facts, and R1's edges and oracle, for the
  native audit and its property.
- **R2** follows R1.
- **R3** needs R2 and C3. It is sound only once C3 makes every running program cycle-free, and it
  reads C3's flag.
- **C4** follows C3 directly, beside R3, since their files don't overlap (decided 2026-11-12).
- **R4 and R5** follow R3. **C5** needs counting first, since elision removes counts.
- A phase starts only on landed code, and beside a running one only when their files don't overlap.

## Shared surfaces and owners

| Surface | Owner | Consumers |
|---|---|---|
| Witness closing on the checker's surface | C1 | C3, lowering |
| The flow IR and its entry (`rules/flow/`) | C1 | `dropped.ts`, `data-kinds.ts`, C3, C4, C5 |
| Annotations: generic, scoped, on struct declarations | C2 | tools, the boundary's annotations |
| `Holds` read by `heldPartsOf` (`externHeldOf`); `keepsOf(extern)`; the `lifetimes` module | C2 | C3 (the audit too), sendability, must-use |
| `Diagnostic`'s related locations | C3 | expansion, the LSP, the CLI |
| `reachesDisposable(type)` and the Definition's `counted` flag | C3 | R3, lowering |
| Summaries, requirements, field labels and the plain-function seam | C3 | C4 |
| Edges by root, and the oracle | R1 | C3's property, R3, C5 |
| The holder seam, and serial identity | R2 | R3, R4, R5 |

A contract amendment goes to the tech-lead, who decides and tells the affected phases.

**Diagnostic ranges** (checker, `diagnostics/lifetimes.ts`; 5712 is the next free code today):

| Phase | Codes |
|---|---|
| C2 | 5750–5759 |
| C3 | 5720–5739 |

## Verification beyond each phase

- **The oracle** stays in the test runtime for good. It is the ground truth both for the analysis's
  soundness and for the IR agreeing with lowering.
- **Properties** over fragment soups (`test/soup.ts`):
  - accepted programs never trip the oracle;
  - generic and instantiated verdicts commute;
  - incremental equals fresh.
- **Merge reviews:**
  - after C3, on the invariant, the spec text, and every edge in `holdings.ts` modelled by the
    analysis;
  - after R3, on the runtime lane.
