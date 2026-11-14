---
description: plan for FormBuilder's `computed` module and FormBuilder rebuilt on it (simple core, browser and backend live functions, nothing async in expressions) — process, three phases and their acceptance criteria; read before forking or examining it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [plan, computed, reactive, forms]
---

# Plan: computed

Design: `design.md` (same folder). FormBuilder spec: `examples/FormBuilder/form-builder-spec.md`.

## Process

Three sequential phases, each by an implementer fork with QA and a cold reviewer running
concurrently, then a cold merge review of the whole branch. Sequential because each phase is the
next one's API and test bed. The module is too small to stub against, and the generator's target
is the module C2 writes by hand. C1 merges to main alone. C2 and C3 commit on branch
`computed-forms`, merged to main after C3: between them, `supplier.gen.ista` doesn't compile
against the new `forms.ista`, so `test/examples.test.ts` fails on it alone until C3 regenerates it.

## C1: the `computed` module

`examples/FormBuilder/computed.ista` as designed, with `.ista` tests beside it.
- One view evaluates each computed it reads at most once; a second read in the view evaluates
  nothing.
- A computed re-evaluates only when a dependency's `changed` is after its `checked`. Setting a
  source re-evaluates only the computeds reading it, directly or through others, and setting it to
  an equal value re-evaluates nothing.
- An equal result leaves `changed`, so readers above it don't re-evaluate.
- In a k-deep diamond chain, a view visits each dependency once: the visits grow linearly with k.
- A computed whose condition flipped re-evaluates without bringing up to date the reads behind
  the condition.
- A computed of `Int?` giving `none` reads as `none`, with no panic.
- A computed reading itself, directly or through another, gets its previous value, and the next
  view re-evaluates what read the old one. During its first evaluation that read panics, and so
  does reading another graph's node in a view.
- The module checks with no lifetime errors.

## C2: the forms core and its two live functions

`forms.ista` rewritten as the design's simple core, with the browser and backend live functions,
the sources and the browser's event and tree externs mocked, and a hand-written `order.gen.ista`
in the new shape. Its
`.ista` scenario tests run both functions. The FormBuilder spec's runtime sections (§3, §4.3, §6,
§7, §8, §10) are updated, its stable-references claim with them.
- `forms.ista` marks nothing `ista`, and only the two drivers `live`; nothing in it awaits but the
  browser's next event. The `0..8` loop, `unshow`, `Drawing`, `View.runs`, `Task` and
  `Check.Later` are gone, and so are `Sc` parameters, `ScopedView` and `any View<Sc>`.
- No source is set during a view: defaults, computed values, computed rows and tags, and
  `Hidden.shown` are computeds.
- Browser:
  - an edit re-evaluates only the nodes reading it;
  - a hidden node's expressions never run;
  - a valid submit sends the form's value and returns.
- Backend: a valid value gives its typed `Data`, and an invalid one gives errors by node key.
  Values for hidden nodes are dropped from the `Data`.

## C3: the generator

`generate.ts` emits getters and expression functions and no longer looks for `await` (fixing Q43
on the way). `pending` leaves `form-spec.ts`, the forms' JSON calls sources directly, and the
spec's §4 and §5 follow.
- Generating `order.form.json` gives C2's `order.gen.ista`, as formatted.
- `supplier.gen.ista` is regenerated, compiles, and its spec §9 features run through both
  functions with mocked sources.
- `node generate.ts *.form.json` runs under Node's type stripping.
- `test/examples.test.ts` and `form-spec.test.ts` pass, and `npm run verify` is green again.
