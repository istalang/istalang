---
description: Int precision, Float semantics, division and division by zero; read before changing numeric operators
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 3.4 Numbers

**Numbers.** `Int` has arbitrary precision, as in Python, so it never overflows. `Float` is an IEEE 754 double. `/` always yields a `Float` and divides as IEEE 754 does, so dividing by zero gives an infinity or NaN; `//` is floor division on `Int`s, and `//` or `%` by zero panics (§12). For exact decimal arithmetic, such as money, the standard library has `Decimal`.
