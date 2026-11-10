---
name: build-on-constructs
description: language features are built in Istalang on existing constructs, not as new runtime builtins or externs; verify cheap scouts' findings and read docs/reuse first
metadata:
  type: feedback
---

Build a language feature in Istalang on the constructs that already exist, not as a new extern, native or runtime state. For `delegate` the human chose "ista sends a message, live loops on it": a live loop written in Istalang over CX's `rt.call`, so DG moved after CX (2026-11-11).

**Why:** the human corrected a design that added a `delegate` native, a job future state and a runtime job runner, saying "no extern/builtin must be necessary".

**How to apply:** before designing, read `docs/reuse/*.md` and the std modules (`inbox`, `rpc`, `fanout`, `runtime`) for what already does the job; propose the runtime-side mechanism only when no construct can carry it, and ask. Don't lean on sonnet scouts: check their findings against the code, and use stronger tiers for research that decides a design. See [[feedback-coordination]].
