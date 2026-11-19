---
description: marks on trait requirements and what meets them; read before changing marked trait requirements
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 9.3 Requirement marks

- **Requirement marks.** A requirement carries a mark (§9.1), written on its head as a function's is: `K fn produce(self: Self) -> Future<Int, K>` in `trait Producer<K in Persistence>`, or `Self.Mode fn onAwait(…)` for an associated type bounded to marks, one of `Persistence` on an async head. A function meeting it handles what the requirement allows and the implementing type's own data: a requirement of a kind is met by a function of that kind or an unmarked one, and an unmarked requirement by an unmarked function or one of the implementing type's kind, so `Socket`'s `live fn dispose` meets `Disposable`'s unmarked `dispose`, and a revertible send's `ista fn dispose` makes it disposable. A function generic over its mark meets any, as its instantiation does. Its kind there is that of all it calls through its own constraints too (§9.2): a phantom `Phantom<T>`'s unmarked `default` calling `T.default()` doesn't meet `Default` for `Phantom<LiveResource>`, whose values hold no kind, since a type whose values carry no kind can't lend live code to simple callers. Generic code therefore calls a requirement as its mark allows.
