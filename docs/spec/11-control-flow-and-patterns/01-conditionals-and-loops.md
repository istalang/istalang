---
description: if, match and loop rules, conditions decided by types, guards, labels on loops, return; read before changing control flow
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 11.1 Conditionals and loops

```python fragment
const label: String = if amount > 50_000:
    "large"
else:
    "normal"

const verdictText: String = match v:
    case Verdict{ok == true}:
        "approved by " + v.role
    case Verdict{ok == false}:
        "rejected by " + v.role
```

The rules:

- `if` without `else` must have type `Unit`.
- **Conditions decided by types.** A comparison or `is` whose outcome its operands' types fix is decided: `==` or `!=` of two literals; of a literal and a value whose type can't hold it (a literal type, a union of literals, a member parameter, a struct's keys not known yet but those its constraint names, §5.2, §8.1); of a literal or `none` and a value of a type known where it is checked that never compares with it (`u == true` against an `Int | String`); and `x is` a pattern its subject's type rules out (§11.3). It is that value, its operands still run, and it is warned of where it stands, in a field loop only when every pass decides it so. A condition built of decided ones with `not`, `and` and `or` rules out the branch that never runs, which is neither checked nor run; a bare `true` or `false` decides nothing. Always false, its own branch is ruled out; always true, every branch after it and the `else`. Nothing narrows: an undecided condition leaves its operands' types as they are.
- `match` must be exhaustive. Use `case _:` for the rest. Patterns are described in §11.3.
- The cases of a `match` and of a `select` (§15.4) stand one per line, with nothing after a case on its line: neither `;` nor `,` separates them (§2.1).
- A `case` may have a guard: `case Verdict{ok == false} as v if v.role == "cfo":`. A guarded case matches only when its condition is true, so guarded cases don't count toward exhaustiveness.
- `x is Pattern` tests a value against a pattern outside `match`, as in `if r is Ok(y):` (§11.3).
- `while` and `for x in xs` are statements of type `Unit`. `for` works on any type that satisfies `Iterable` (§8.4). `break` and `continue` work as in Python, on the innermost loop.

- **Labels.** A body's line `Name:` with a block below it is a label, never a value: an indented value opens only after `=`, `return`, a key or `-` (§3.2). A label written on its loop's line, `outer: for x in xs:`, names the loop: `break outer` and `continue outer` leave or go on with it from any depth inside it, as in Java or JavaScript. A label ending its own line names the block indented below it, even one holding a loop, and only `hold` names such a block (§7.1). A label belongs to its function: a nested function never sees it, and it may not repeat a label around it nor take the function's own name, so a name means one loop or block. A label nothing names is warned about.
- `return expr` exits the enclosing function; `expr` must have the function's return type.
