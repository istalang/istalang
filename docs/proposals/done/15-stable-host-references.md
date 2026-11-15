---
description: proposal 15 of docs/proposals, stable host references — a value the program gives a host again, unchanged, arrives as the same frozen JavaScript object at every depth, through identity caches on both encoding stages; rules, mechanism, soundness against in-place writes, spec edits and the decisions; read before designing or implementing it, or a host that relies on reference equality (React)
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [proposal, runtime, boundary, host, json, identity, react, forms]
---

# Proposal: stable host references

**Motivation.** Every value crossing to a host is JSON (§9; `docs/arch/boundary.md`), built anew
at every crossing. A React host renders a tree the program sends after every event, and it skips
work by reference equality (`memo`, `useMemo`). Today it gets new objects every time, so it
re-renders everything or deep-compares everything:

```python
extern live fn show(tree: Tree)

live async fn main():
    const fixed = [1, 2, 3]
    ...
        show(Tree{total, fixed})   # `fixed` reaches the host as a new array at every call
```

Run with `ista run --host`, the host's `tree.fixed` differs from the previous call's every time.
FormBuilder's spec assumes otherwise ("the interpreter's bridge returns the same JavaScript
reference for a shared struct as long as it hasn't changed"); no such bridge exists. Its computed
views keep the old object for an equal result (`docs/work/computed/design.md`), so the program
already knows what didn't change. The boundary throws that away.

## The rule

**A value given to a host again, unchanged, is the same JavaScript object, at every depth.** What
the host gets for an extern's argument or a run's outcome is frozen, and a part the program kept
(held and passed again, not rebuilt) is the object the host got for it before.

- **Identity follows the kept value, not equality.** A value rebuilt equal is a new object to the
  host. A program that wants the old object keeps it, as an equal-result cutoff does. Interning
  every value built would cost every program for what one kind of host needs.
- **Primitives are their own identity:** strings, integers (`bigint`), floats, booleans and
  `null`.
- **Frozen:** a host can't change an object it may be given again.
- **Within one instance.** A value crossing between instances is rebuilt
  (`scheduler/instance/crossing.ts`), so identity holds within one instance only, and never
  across restarts.
- **Codecs must be pure:** a type's `toJson` runs at most once per unchanged value in an
  instance, so one with effects would run fewer times than called. Derived and std codecs are pure
  already. Mocks exist only in a test world (§10), which keeps no stage-1 encodings, so a mocked
  codec sees every call; identity is visible only to a JavaScript host anyway.

## Mechanism

Encoding runs in two stages today, each building anew: compiled `toJson` turns a value into a
`Json` value (derived codecs are synthesized Istalang, `_toJson<T>`; `Array`, `Map` and `T?`
codecs are std Istalang functions), then the runtime turns that into plain JavaScript
(`plainOfJson`, `definition/values/json-values.ts`). Each stage gets a weak identity cache.

- **Values are shared by reference** in the interpreter: registers, moves, calls and returns pass
  the same object. So "kept" is already "the same object"; only the encoders build anew.
- **One write path, `json.encode<T>`.** Every encoding of a part goes through it: the write codec
  lowering calls (`codec-calls.ts`: derived codecs' fields, extern arguments, outcomes) closes
  `encode<T>` instead of the witness, and the std `Array`, `Map` and `T?` codecs call
  `encode(each)`. The cache lives in `encode`'s body, Istalang over two natives (look up,
  remember), so an unchanged element of a changed array hits it too. Caching at the call, not in
  the codec, keeps it sound for a codec with defaulted parameters called directly with others.
- **Stage 1, value to `Json`:** keyed by the value object and the closed `encode<T>` instance.
  Coherence (§3.10) makes `T` decide the codec, and one object may be written by two codecs: a
  conversion that keeps the layout (`Box<"a">` to `Box<String>`, tuples of them) shares the object
  between two types. `T` is the type as lowering closes it, tuples included, never only a named
  type entry. Scoped per instance, beside its counts: a codec may read a `context` constant, whose
  value is per instance (§3.4), and a new Definition's codecs are new instances of `encode`. A miss
  is its own case, never `none`, which is a `Json` value.
- **Stage 2, `Json` to JavaScript:** `plainOfJson` keeps a weak map from the array or map inside a
  `Json` (not the union's variant wrapping it, which each conversion to `Json` makes anew) to the
  frozen plain object it made and its nesting height. The height is what the uncached walk would
  check, so the nesting limit refuses exactly what it refused before.
- **In-place writes stay sound** (`runtime/lifetimes/in-place.ts`), by two rules:
  - **The cache is a holder.** Remembering holds the `Json` in the instance's counts, as every
    holder that keeps a value is counted, so no part of a cached `Json` is ever written in place.
  - **A changed node is forgotten.** Every node an in-place write changes forgets both its cache
    entries, through the one function every change path calls with the summaries and hashes it
    already forgets. A written value's ancestors are on its path, since a node held once has one
    parent, so each is forgotten too.
  - A key is not disowned when remembered: forgetting suffices, and disowning would copy a whole
    array at its first push after every send.
- **One home:** both caches and their forgetting are defined in one module, beside
  `plainOfJson`; an instance keeps its stage 1 as it keeps its counts. The natives, the boundary
  and the in-place writer call that module, and nothing else knows the caches.

## What it takes

- **Std:** `json.encode`'s body over the two natives; the `Array`, `Map` and `T?` codecs and
  `stringify` call `encode`.
- **Lowering:** the write direction of `codecCall` closes `encode<T>` (well-known by name) over
  the witness resolved at the host site, where a disposable host type is `Encodable` (§9). Traces
  of a codec's panic gain the `json.encode` frame.
- **Runtime:** the identity module (both caches, forgetting), the two natives (remember holds,
  none in a test world), freezing and caching in `plainOfJson`. Outcomes
  (`runtime/boundary/outbound.ts`) and extern arguments (`runtime/boundary/host-natives.ts`) both
  go through it.
- **Checker, Definition format, snapshots:** none. The caches are weak and never persisted.
- **Cost:** a call and a weak-map lookup per part encoded; a hit makes re-encoding an unchanged
  subtree free, so a large tree sent again costs what changed.

**Spec edits:**
- §9: the rule, frozen values, purity of codecs and no stage-1 encodings in a test world.

Docs: `docs/arch/boundary.md` (identity at the boundary), `docs/arch/definition.md` ("Values are
immutable" holds for programs; the interpreter writes in place only where no one else could see
it, now including the host), and FormBuilder's spec §3 and §8 (the identity comes from the
runtime, with no bridge).

## Its first user

FormBuilder (`docs/work/computed/design.md`): its browser function sends the whole tree after each
event, and the computed views keep unchanged nodes' objects. With this proposal, the host gets
those nodes' previous objects, and React skips them.

## Decisions (proposed, for the human)

- **Identity of kept values only**, not interning of equal ones.
- **Frozen objects** at the host.
- **Codecs are pure** by rule, not by check; a test world keeps no stage-1 encodings, so mocks see every call.
- **One runtime:** the host runs in the interpreter's JavaScript realm; no message-channel bridge.

**Rejected:**
- **Interning (hash-consing) every value:** a hash per value built, in every program.
- **The host deep-compares each tree with the last:** every host writes it again, and each
  event costs the whole tree.
- **Stamps on a library's values** (a node's version, reused by key and version at the host):
  a protocol per library, and no help to any other host.
- **Encoding natively, bypassing `toJson`:** codecs are traits a type may declare (§9); a native
  encoder would ignore declared ones.
- **Wrapping each lowered codec call in the cache:** the std codecs' calls in Istalang source
  would miss it, so a changed array would re-encode every element.
- **Memoizing inside each codec:** a codec called directly with a non-default argument would hit
  an entry made with the default.
- **Stage 1 per Definition:** `context` constants, counts and mocks are per instance; a shared
  cache would give one instance another's encoding.
