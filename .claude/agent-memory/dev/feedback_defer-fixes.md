---
name: feedback-defer-fixes
description: in a contract/structural phase, don't fix issues a later phase owns; accept the breakage and defer
metadata:
  type: feedback
---

Don't overwork a phase fixing what a later phase will settle. Reviewer correctness findings about constructs still at the frontier, or behaviour an owning phase decides, are deferred, not fixed now: "break now, fix later".

**Why:** the user said so during language-features L0, when review fixes started sprawling into issues that L1–L7 own.

**How to apply:** fix only what blocks the current phase's acceptance. Record the rest as deferred in the phase report, naming the owning phase, or file it in the tracker. Tell reviewers the same scope in re-reviews. See [[feedback-coordination]].
