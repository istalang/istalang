---
description: String, Int and Bool literals as types: when a literal has one, fitting, agreeing values; read before changing literal types
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 4.3 Literal types

**Literal types.** A `String`, `Int` or `Bool` literal is also a type, whose one value it is: `"draft"`, `42`, `-1`, `true`. `Bool` is `true | false`, and keeps its operators and methods.

- **A literal's type** is its literal type where a literal type of its base, or a union holding one, is expected, and its base type elsewhere: `const s = "draft"` is a `String`, and `const s: Status = "draft"` checks `"draft"` against `Status`. A `let` without a written type widens a literal type to its base (§7.1).
- **Fitting.** A value of a literal type, or of a union of literals of one base, fits that base type: for `s: Status`, `s + "!"` and `s.toUpperCase()` are `String`s. A value of the base never fits a literal type: `const s: Status = name` is an error, while `case "draft" as d` gives `d` the type `"draft"` (§11.3). A lone literal type meets a trait through its base's functions that take the value itself, and through `&`, only through functions declared on the literal type (§7.3). At run time a lone literal type's value is its base's.
- **Agreeing values.** Where several values take one type and none is expected (§10.1), values of literal types of one base agree on that base: `[k1, k2]` is an `Array<String>`, and `if c: k1 else: k2` a `String`, for `k1: "a"` and `k2: "b"`. A literal type held inside another type widens only where a type expects it (§8.1), so values holding different ones agree only when each is a literal of items, a tuple, a struct literal or a collection literal: they agree on the type with every literal type inside it widened, and each converts into it as its items do (§8.1), so `[(k1, 1), (k2, 2)]` is an `Array<(String, Int)>`.

```python
type Status = "draft" | "sent" | "failed"

struct NotFound { id: String }
struct Timeout { ms: Int }

fn find(id: String) -> Result<Int, NotFound>:
    if id == "": Err(NotFound{id}) else: Ok(id.length())

fn load(id: String, waited: Int) -> Result<Int, NotFound | Timeout>:
    if waited > 1000:
        return Err(Timeout{ms: waited})
    Ok(find(id)? + 1)                          # a NotFound converts into NotFound | Timeout

fn mark(s: Status) -> String:
    s + "!"                                    # a Status fits String
```
