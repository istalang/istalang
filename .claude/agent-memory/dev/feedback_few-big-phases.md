---
name: few-big-phases
description: for rewrites, prefer one big late-tested phase over many small phases whose work mostly keeps soon-deleted code green
metadata:
  type: feedback
---

A single phase doing lots of late-tested work that all remains beats many small phases whose work
mostly aligns with old code that will be removed anyway (stubs, ratchets, interim natives, keeping
deleted pipelines green).

**Why:** the human rejected an 11-phase ir-first plan (2026-11-16): "that's a lot of phases, make it
tighter."

**How to apply:** when old code is being replaced, split only where a part can be tested now on the
existing code (land it on main) or runs in parallel; put the rewrite itself in one phase, tested
against goldens at the end. Related: [[simplicity-first]], [[ir-first]].
