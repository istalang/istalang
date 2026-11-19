---
description: worked program: a broadcast whose revertible sends expire when it returns; read for revertible sends in a whole program
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 20.3 Broadcast with expiry

Each subscriber gets its own copy. The revertible sends give the announcement a natural expiry: when `announce` returns, every unread copy is retracted.

```python
import * as time from 'time'

struct Announcement:
    text: String

extern fn announcements(user: String) -> Queue<Announcement>   # Queue as declared in §20.1

ista async fn announce(text: String, users: Array<String>, visibleFor: time.Duration):
    for user in users:
        hold _ = announcements(user).sendRevertible(Announcement{text: text})
    await time.delay(visibleFor)
    # function ends: every unread copy is retracted
```
