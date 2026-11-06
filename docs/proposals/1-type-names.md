---
description: proposal 1 of docs/proposals — PascalCase primitive types (`Int`, `String`, …) and patterns that test a value's type (`case Int as n`) — the rules, what changes in behaviour and power, the spec edits and implementation notes; first in order, since it is mechanical, cheapest before more code accumulates, and gives the type tests later proposals and unions need
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-04
last_updated: 2026-11-04
tags: [proposal, language, naming, patterns]
---

# Proposal: PascalCase primitives and type patterns

Every type name becomes PascalCase, primitives included. A PascalCase bare name in a pattern then always refers and a camelCase one always binds, so a pattern can test a value's type. No new syntax. Section numbers refer to `docs/spec.md`.

| Today | Proposed |
| --- | --- |
| `int`, `float`, `bool`, `string`, `unit`, `never` | `Int`, `Float`, `Bool`, `String`, `Unit`, `Never` |
| `int(3.7)`, `float(3)`, `string(42)`, `int.parse("42")` | `Int(3.7)`, `Float(3)`, `String(42)`, `Int.parse("42")` |

## Rules

- **Type names.** Every type name is PascalCase. The primitives stay language built-ins, declared in no module and always sendable (§2); only their spelling changes.
- **Freed names.** `int`, `float`, `bool`, `string`, `unit` and `never` become ordinary camelCase names, for variables, fields and functions alike.
- **Type patterns.** A PascalCase bare name in a pattern refers, as today (§3.11): to a variant, a struct without fields, or now any type, matching every value of it.

```python
fn describe(x: any Stringable) -> String:
    match x:
        case Int as n: `a number, ${n}`
        case Email as e: `mail to ${e.to}`
        case _: String(x)

fn shout(x: any Stringable) -> String:
    if x is String as s: s.toUpperCase() else: String(x)
```

  - `as` binds the matched value with that type, as in any pattern (§3.11).
  - A variant with fields is still written with braces, since a variant isn't a type.
  - It gives no type arguments, as a pattern on an `any` value doesn't today (§3.10), so it can't name a generic type.
  - A type the subject can't hold is a compile error: one that doesn't meet an `any` type's traits, or, against any other subject, a type other than the subject's own.
  - Against a subject of that very type, it matches every value, as `_` does.
  - It covers its whole type for exhaustiveness.
- **Unchanged.** Functions, variables, fields and constants stay camelCase, and a constant is still compared through a qualified name or a guard (§3.11). A leading `_` still makes a name private (§3.13). `true`, `false` and `none` stay keywords, and `any` stays contextual.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `let n: int = 0` | valid | `let n: Int = 0` |
| `float(3)`, `string(x)` beside `Decimal(i)` | two spellings of `T(x)` | one: `Float(3)`, `String(x)` |
| `case int:` | binds a variable named `int` | `case Int:` tests the type |
| an `int` inside an `any Stringable` | can't be matched | `case Int as n` |
| a whole `Email` inside an `any` | matched through its fields, `case Email{to} as e` | also `case Email as e` |
| a variable named `string` | clashes with the type | an ordinary name |

## What changes in power

- **Gained.** Type tests for primitives and for whole structs, on `any` values today and on union types (`3-union-types.md`); the pattern `2-structural-types.md` uses for an alias of a shape; one form for every conversion (§3.10).
- **Lost.** The lowercase spellings Python and TypeScript readers expect.

## Spec changes

- **Cheat sheet.** The type line reads `Int  Float  Bool  String  Unit  Never  T?  (A, B)`; every other line follows the rename.
- **§2.** "Primitive types are lowercase language built-ins … Every other type name, built-in or user-defined, is PascalCase" becomes "Every type name is PascalCase; the primitives are language built-ins". The type table and the **Numbers** paragraph follow.
- **§3.10.** **Conversions:** `Float(3)`, `Int(3.7)`, `String(42)`, `Int.parse("42")`. The built-in traits table follows. **Matching:** a pattern naming a type matches an `any` value holding one, primitives included, and may be a bare type name.
- **§3.11.** "a PascalCase one refers to a variant or a struct without fields" gains "or a type"; a new bullet **Type patterns**, from the rules above.
- **Everywhere else.** Every example and every prose mention renames mechanically. The spec's examples are test inputs (`test/corpus/spec-examples.ts`), so the spec changes in the same commit as the compiler.

## Implementation notes

1. **One list.** `src/language/primitives.ts` holds `primitiveNames`; the binder's scope and entities (`src/compiler/binder/scope.ts`, `entities.ts`) and the checker (`types/type/index.ts`, `context.ts`) read it, so the rename starts there.
2. **The Definition's spelling.** The primitives are "spelled the same way by the compiler and by the Definition it produces" (`primitives.ts`), and `src/definition/extern-key.ts` builds extern keys from them. A deploy refuses a program whose extern has a different type from the one the runtime holds (§3.6), so a renamed spelling would refuse the next deploy of every program with externs. Keep the Definition's spelling as it is, through one table in `primitives.ts` from source name to Definition spelling, or accept one breaking deploy.
3. **Patterns.** `src/compiler/binder/patterns.ts` already tells binding from referring by case, so the binder doesn't change. `checker/patterns/matching.ts` resolves a referring name to a type as well: on an `any` subject it lowers as a struct pattern on one does today, a check of the closed enum's variant (`lowering/tables/type-table.ts`); on a subject of that type it is a catch-all.
4. **Exhaustiveness.** `checker/patterns/exhaustiveness/exhaustiveness.ts` counts a type pattern as covering its type's every constructor.
5. **Standard library.** The 34 `.ista` modules under `src/stdlib/`, and `src/stdlib/prelude/text-forms.ts`.
6. **Tooling.** The VS Code grammar (`.vscode/extensions/ista/syntaxes/ista.tmLanguage.json`) and its test (`test/vscode-grammar.test.ts`); semantic tokens, completion and hover read names from the checker and need no change.
7. **Tests.** TypeScript tests embedding Istalang source rename with it. Properties: a PascalCase bare name in a pattern never binds; a type pattern on an `any` matches exactly the values converted from that type.
8. **Migration hint.** An unknown lowercase primitive name can report "did you mean `Int`?" for a while.
