---
description: worked program: the approver side of the purchase approval, a host-started run sending a verdict; read with 20.1
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 20.2 Approver side

The task-list UI shows the reviews waiting in `reviewQueue(role)`; how the host reads and claims them is up to the host. On submit, the host starts this function on the purchase's version. The verdict goes into the host-provided `verdicts` queue, because a run the host starts is separate from the purchase (§15.1).

```ista
fn submitReview(task: ReviewRequest, role: String, ok: Bool, comment: String):
    verdicts(task.purchaseId).send(Verdict{role: role, ok: ok, comment: comment})
```
