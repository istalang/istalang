---
description: reserved and contextual words, declaration-head modifiers and their order, built-in type names; read before adding a keyword or a modifier
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 2.2 Reserved words and modifiers

- **Reserved words:** `fn`, `async`, `await`, `let`, `const`, `if`, `elif`, `else`, `for`, `in`, `while`, `match`, `case`, `select`, `return`, `break`, `continue`, `struct`, `enum`, `trait`, `import`, `extern`, `drop`, `is`, `and`, `or`, `not`, `true`, `false`, `none` and `as`. Seventeen more words are keywords only where the grammar expects them and ordinary names elsewhere: `type` before an alias's name, or an associated type's in a struct, enum or trait body (§5.2, §8.2), `shared`, `sendable`, `inert`, `live` and `ista` among a head's modifiers (below), `gives` and `takes` before a type parameter's name or `...` (§8.1), `new` before a name (§5.4), `from` before an import's path, `any` before a trait's name in a type (§8.3), `keyof` before a type in a type (§5.2), `infer` before a type variable's name in a type `match` case's pattern (§4.6), `hold` before the variable declaration it holds (§7.1), `transient` before the `let` it modifies (§7.1), `get` between `fn` and a getter's name (§5.2), and `by` after a range, before its step (§19.3). So `T.from` (§8.4), a field named `type` and functions named `hold` and `get` (`fn get(`) are valid. A head's **modifiers** stand before its `fn` or `struct` in any order, each once and one word of each group: `extern` (§17.2); a function type's sendability, `sendable` or `inert` (§6.4), or an extern struct's handle, `shared`, `sendable` or `live` (§17.2), or a shared struct's `shared` (§5.4); a function's kind, `live` or `ista` (§9.1); and `async`. The formatter writes them in that order: `extern live async fn`, `extern shared struct`, `sendable ista async fn(A) -> R`. `sendable` implies `inert`, so a head writing both is no error: it means `sendable`, and the formatter drops `inert`. The built-in types' names, `Int`, `Float`, `Bool`, `String`, `None`, `Unit`, `Never` and `Self` (§8.2), are no keywords, but no type, variant or type parameter is declared with them, since every module sees them.
