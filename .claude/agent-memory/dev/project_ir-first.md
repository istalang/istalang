---
name: ir-first
description: the human's direction (2026-11-16) — everything lowered to the IR, every backend (interpreter, JS codegen, LLVM) runs it alike, no interpreter-only features; plans are complete greenfield refactors, not patches
metadata:
  type: project
---

Everything a program does, ista code included, is lowered to the Definition IR; the interpreter,
compiled JS and the planned LLVM backend execute it alike. An interpreter-only feature is bad,
lazy design to remove; if the interpreter has no benefit left, it goes. The IR carries whether a
value reaches a disposable, so JS (GC) tracks disposables only and LLVM refcounts every heap value
with a periodic cycle collector.

**Why:** the human won't keep three runtimes in sync, fixing the same bug class in each: "a clean
code base doing the right thing once, not a dozen hacky patch-work maintained. it must be kept
green field!" They expect lowering and runtime to need big refactors.

Decided 2026-11-16: capture golden outputs from the interpreter, then delete it completely; where
new code differs throughout, rewrite rather than migrate ("fastest cleanest path"; breakage is
acceptable, tests catch it). Primitive ops (Int `+`) must be as fast as hand-written JS in codegen.

**How to apply:** plans are complete rewrite/refactoring plans (structure, deletion, one home per rule),
never a feature or perf patch on top of what exists; no backward compatibility. Work lives in
`docs/work/done/ir-first/`. Related: [[simplicity-first]], [[build-on-constructs]].
