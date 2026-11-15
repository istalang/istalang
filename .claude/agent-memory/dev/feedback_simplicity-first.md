---
name: simplicity-first
description: simplification is the user's #1 design priority — drop machinery (caching, per-module builds, optimizations) that isn't forced by the spec or a measured need
metadata:
  type: feedback
---

Simplification outranks every other design goal. Machinery that buys only speed or caching (build
caches, per-module output, static optimizations) is dropped unless the spec forces it or a
measurement demands it; fewer, larger phases beat many small ones.

**Why:** reviewing the JS codegen design (2026-11-15), the user said "Simplification must be the
number one priority… if per-module building makes it complex, drop it completely… I prefer
simplifications if they make the plan tighter and smaller work."

**How to apply:** when reviewing a design or planning, cut every part not forced by the spec, and
present the cuts as the default rather than as an option. Related: [[build-on-constructs]].
