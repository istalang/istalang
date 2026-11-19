---
description: where type annotations are required and where they may be inferred; read before changing what may omit a type
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 4.4 Type annotations

Type annotations are required on the parameters of declared functions and on struct fields. A lambda may omit parameter types when the expected function type gives them (§6.4), and a parameter with a default value may omit its type, which is then inferred from the default. Return types may always be omitted, on any function, exported or not, and are then inferred from the body; a recursive function writes its own, since its body refers to it, unless it is a lambda taking its result from the function type it is expected as (§6.4). A local `let` or `const` may omit its annotation when the initializer's type is unambiguous. Type parameters are written in angle brackets (§8.1).
