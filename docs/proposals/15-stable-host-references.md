---
description: proposal 15 of docs/proposals, stable host references — a value the program gives a host again, unchanged, arrives as the same frozen JavaScript object at every depth, through identity caches on both encoding stages, and a bridge keeping that identity across a Worker's message channel; rules, mechanism, what it takes, spec edits and the decisions; read before designing or implementing it, or a host that relies on reference equality (React)
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
- **Within one runtime.** A value crossing between instances is rebuilt
  (`scheduler/instance/crossing.ts`), so identity never spans instances, and neither does it span
  restarts.
- **Codecs must be pure:** a type's `toJson` runs at most once per unchanged value, so one with
  effects would run fewer times than called. Derived and std codecs are pure already.

## Mechanism

Encoding runs in two stages today, each building anew: compiled `toJson` turns a value into a
`Json` value (derived codecs are synthesized Istalang, `_toJson<T>`; `Array`, `Map` and `T?`
codecs are std Istalang functions), then the runtime turns that into plain JavaScript
(`plainOfJson`, `definition/values/json-values.ts`). Each stage gets a weak identity cache.

- **Values are shared by reference** in the interpreter: registers, moves, calls and returns pass
  the same object. So "kept" is already "the same object"; only the encoders build anew.
- **Stage 1, value to `Json`:** lowering wraps each write-codec call on a composite value in a
  lookup and a remember, two natives over a `WeakMap` from value object to its `Json` value. A
  struct's derived codec calls its fields' codecs through the same wrapping, so an unchanged field
  hits the cache even when its parent changed.
- **Stage 2, `Json` to JavaScript:** `plainOfJson` keeps a `WeakMap` from `Json` value object to
  the frozen plain object it made, so a cached `Json` value gives the same object again.
- **In-place writes stay sound.** The interpreter writes a value in place only when this instance
  made it and one holder holds it (`runtime/lifetimes/in-place.ts`). Two rules, in that one home:
  - **A cached value is never written in place:** remembering it removes it from the instance's
    own set, as for values a native made, so its first write copies.
  - **A changed key is forgotten:** an in-place write forgets the cached `Json` of every node on the
    written path, through the seam that already forgets their hashes and summaries
    (`forgetDerivedOf`).
- **One home:** both caches and both rules sit in one runtime module, which the boundary and the
  in-place writer call; nothing else knows them.

## Across a message channel

A host running the interpreter in a Web Worker posts what it gets to the page, and the structured
clone makes new objects again. The package gains a bridge for that hop, `istalang/bridge`:

- **A sender and a receiver,** one pair per channel. The sender numbers each object it sends, sends
  an object it sent before as its number, and a new one whole. The receiver keeps its objects by
  number and rebuilds each message from them, frozen.
- **Both keep what the latest message reached.** The channel is ordered, so each side computes
  the same set after each message and drops the rest, with no acknowledgements.
- **The sender's input is the runtime's output,** whose identity stage 2 keeps, so an unchanged
  subtree is a number on the wire, and the page's object for it is the one it had.

## What it takes

- **Runtime:** the identity module (both caches, the two in-place rules), the two natives, and
  `plainOfJson`'s cache. Outcomes (`runtime/boundary/outbound.ts`) and extern arguments
  (`runtime/boundary/host-natives.ts`) both go through it.
- **Lowering:** the lookup and remember around write-codec calls on composites
  (`lowering/synthesized/boundary/codec-calls.ts`).
- **Package:** `istalang/bridge`, the sender and receiver, with no dependency on the rest.
- **Checker, Definition format, snapshots:** none. The caches are weak and never persisted.
- **Cost:** a weak-map lookup per composite encoded; a hit makes re-encoding an unchanged subtree
  free, so a large tree sent again costs what changed.

**Spec edits:**
- §9: the rule, frozen values, purity of codecs.

Docs: `docs/arch/boundary.md` (identity at the boundary, the bridge), `docs/arch/definition.md`
("Values are immutable" holds for programs; the interpreter writes in place only where no one else
could see it, now including the host), and FormBuilder's spec §3 and §8.

## Its first user

FormBuilder (`docs/work/computed/design.md`): its browser function sends the whole tree after each
event, and the computed views keep unchanged nodes' objects. With this proposal, the page gets
those nodes' previous objects, and React skips them.

## Decisions (proposed, for the human)

- **Identity of kept values only**, not interning of equal ones.
- **Frozen objects** at the host.
- **Codecs are pure** by rule, not by check.
- **The bridge ships in the package**, so every Worker host gets the same protocol.

**Rejected:**
- **Interning (hash-consing) every value:** a hash per value built, in every program.
- **The host deep-compares each tree with the last:** every host writes it again, and each
  event costs the whole tree.
- **Stamps on a library's values** (a node's version, reused by key and version at the host):
  a protocol per library, and no help to any other host.
- **Encoding natively, bypassing `toJson`:** codecs are traits a type may declare (§9); a native
  encoder would ignore declared ones.
