---
description: when a match covers its subject's type; read before changing exhaustiveness checking
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 11.4 Exhaustiveness

**Exhaustiveness.** A `match` covers its subject's type when every value of it matches a case without a guard. A type is made of its constructors: an enum of its variants, a union of its members, a literal type of its one value, so `Bool` of `true` and `false`, a tuple or a struct of its one shape, field by field, and an `Array` of its lengths, so `[]`, `[x]` and `[x, y, ...rest]` cover every array. An alternative covers what any of its alternatives covers, and a range acts like a guard. `Int`, `Float`, `String` and the other types have no such list, so their literals never cover them; only a pattern taking anything does, or one naming the type. `==` against a literal or an enum variant counts as that pattern, so `next == none` covers a `T?`'s `None` member, while other comparisons, and `==` against a constant, act like guards (§11.1) and don't count. Nested patterns count by the same rules. A missing case is reported with examples of what isn't handled, and a case no value can reach, given the cases before it, is warned about. After a collapse (§4.2), the first case that matches wins, as among a pattern's alternatives; a case the collapse leaves unreachable isn't reported, since another instantiation may reach it.
