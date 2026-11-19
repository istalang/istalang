---
description: values copied on assignment, passing and sending, and which types are handles; read before changing copying or identity
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 7.2 Value semantics and handles

**Value semantics.** Structs, arrays and maps are values. They are copied structurally, field by field, when assigned, passed to a function, returned or sent. A by-value parameter is immutable (§6.1). The only ways a function can change data its caller holds are an explicit reference (§7.3) and a handle, such as a `Shared` value (§19.1). A **handle** is a value of a type its declaration makes one, never its name: every shared struct (§5.4), such as `Shared<T>`, `Inbox<T>` and `Revertible<T>`, and every extern struct declared `shared`, `sendable` or `live` (§17.2), such as `Slot<T>`, `Future<T, K>`, `WeakRef<T>` and `Instance<T>`. Copying one copies the handle, not the state behind it, and `==` compares handles by identity.
