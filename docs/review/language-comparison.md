---
description: Istalang compared with TypeScript, Rust and Go, feature by feature, plus measured codebase size, test ratio, duplication and file-cap results, with the commands that reproduce them — read before judging scope, planning type-system work, or refreshing these numbers
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [review, language, comparison, metrics, duplication]
---

# Istalang compared with TypeScript, Rust and Go

Measured on branch `p4-computed` at `cfd9b3c2`, whose `docs/spec.md` includes proposals 1–4: type names, structural types, union types and computed types. Section numbers refer to that spec.

## Features

`—` means the language has no such feature.

### Types

| Feature | Istalang | TypeScript | Rust | Go |
| --- | --- | --- | --- | --- |
| Tagged sum types | `enum`, variants with fields (§3.11) | discriminated unions by convention | `enum` | — |
| Exhaustive matching | built in; reports examples of missing cases and warns about unreachable ones (§3.11) | only indirectly, e.g. assigning the leftover to `never` | built in | — |
| Patterns | nested, literal, range, array with rest, struct with rest, type, alternatives, guards (§3.11) | — (narrowing by `if`/`switch` instead) | nested, literal, range, slice, `@` bindings, guards | type switch only |
| Untagged unions of any types | `A \| B` (§2) | yes | — | only inside constraints (type sets) |
| Literal types | `String`, `Int`, `Bool` literals (§2) | yes, plus template literal types | — | — |
| Structural record types | anonymous struct types, field order ignored; a nominal struct converts to its shape (§3.1) | every object type is structural | — (tuples only) | unnamed struct types, same fields in the same order; named ↔ unnamed assignable |
| Field-level constraints on a type parameter | `S is struct { title: String; [_] is C }` (§3.5) | `T extends { title: string }`, index signatures | — | — |
| `keyof` and indexed access `S[K]` | yes (§3.1) | yes | — | — |
| Mapped types | `{ [F in keyof S]: T }`; no key remapping or modifiers (§3.1, §14) | yes, with `as` remapping and `?`/`readonly` modifiers | — | — |
| Conditional types | type `match` with `infer`, distributing over unions, recursive (§3.17) | conditional types with `infer`, distributive, recursive | — | — |
| Intersection types | — (`&` only joins traits in constraints) | yes | — | — |
| Narrowing by control flow | — (§4 "Nothing narrows"); `is` binds new names instead (§3.11) | yes | — (bindings in `match`/`if let`) | — (bindings in a type switch) |
| Type predicates | — (§14) | yes | — | — |
| Soundness | aimed for; a generic body is checked once and using it never reports an error inside it (§3.5) | unsound by design (`any`, method parameter bivariance) | sound outside `unsafe` | sound |
| Integers | `Int` of arbitrary precision (§2) | `number`; `bigint` separate | fixed widths | fixed widths; `math/big` |

### Abstraction

| Feature | Istalang | TypeScript | Rust | Go |
| --- | --- | --- | --- | --- |
| Conformance | structural: a type meets a trait when the functions exist; no `impl` blocks (§3.10) | structural | nominal `impl` | structural, methods only |
| Coherence | functions must be declared beside the type or the trait (§3.10) | n/a | orphan rule (same idea) | n/a |
| Associated types | yes, without type parameters (§3.1, §14) | — | yes, with type parameters (GATs) | — |
| Static requirements | `fn Self.zero()` (§3.10) | — | yes | — |
| Values of any type meeting a trait | `any A & B`, with object-safety rules (§3.10) | every value | `dyn Trait`, dyn compatibility | interface values |
| Generic compilation | one copy per instantiation (§3.5) | erased | one copy per instantiation | GC-shape stenciling with dictionaries |
| Variadic generics | packs `<...A>` (§3.5) | variadic tuple types | — | — |
| One instantiation per union member | `S in U` (§3.5) | — | — | — |
| Const generics | — | — | yes | — |
| Higher-kinded types | — | — | — (GATs approximate them) | — |
| Overloading by parameter types | yes (§3.7) | several signatures, one implementation | — | — |
| Operator overloading | through named functions and traits (§3.9) | — | through traits | — |
| Named and default arguments | both (§3.3) | defaults only | — | — |
| Code generated per field of a struct | field loops and struct comprehensions, checked once per field (§4); derived JSON codecs (§9) | — (types are erased) | procedural macros | `go generate`, `reflect` |
| Macros | — | — | declarative and procedural | — |
| Reflection | — (§3.16) | at run time, on values only | `Any`/`TypeId` only | `reflect` |

### Memory and execution

| Feature | Istalang | TypeScript | Rust | Go |
| --- | --- | --- | --- | --- |
| Memory model | values are copied; `&` only on parameters, never stored (§3.7); shared structs for identity (§3.18) | GC references | ownership and lifetimes | GC and pointers |
| Releasing resources | holder-based, deterministic at block end; `drop`, `defer` (§7) | `using` (TS 5.2) | `Drop` | `defer` |
| Errors | `Result` and `?`; a panic freezes the instance for an operator (§3.12) | exceptions | `Result` and `?`; `panic` | multiple results; `panic` |
| Concurrency | async calls run alongside their caller, cooperatively; slots and `select` (§6, §8); `spawn` starts an independent instance (§9) | event loop | threads and async | goroutines, channels, `select`, in parallel |
| Parallelism inside one program instance | — | — (workers aside) | yes | yes |
| Durable execution | every `await` commits a snapshot, which can resume after a restart (§5) | — | — | — |
| Deterministic re-runs | `now()` and `random` are fixed per segment; extern results are recorded (§5) | — | — | — |

## What follows from the tables

- **Two families of type features.** Istalang has TypeScript's type computation (literal and union types, `keyof`, indexed access, mapped types, conditional types with `infer`). It also has Rust's nominal ADTs and traits (associated types, static requirements, coherence, one copy per instantiation). TypeScript has only the first family, Rust only the second, and Go neither. The checker implements both, which fits it being the largest folder (38% of `src`, below).
- **Missing compared with at least one of the three:** template literal types, intersection types, key remapping and modifiers in mapped types, narrowing by control flow, type predicates (TypeScript); associated types with type parameters, const generics, macros, ownership and lifetimes, parallelism (Rust); reflection and parallel goroutines (Go). §14 defers the first three type-system items it names (associated types with type parameters, mapped-type modifiers, type predicates); the rest are absent by design.
- **Not found in any of the three:** durable execution at `await`, deterministic segments, holder-based disposal as language rules, revertible sends, instantiation per union member (`S in U`), and code checked once per field without macros.

## Codebase measurements

`src/` without `*.test.*` files: **652 files, 81,215 lines**, 6,207 of them blank. That is about 125 lines per file on average.

| Folder | Lines |
| --- | --- |
| `src/compiler/` | 54,348 |
| ↳ `checker/` (203 files) | 30,638 |
| ↳ `lowering/` | 8,783 |
| ↳ `parser/` | 6,680 |
| ↳ `binder/` | 3,402 |
| ↳ `syntax/` | 3,167 |
| ↳ `scanner/` | 1,177 |
| `src/runtime/` | 7,291 |
| `src/language-service/` | 5,862 |
| `src/definition/` | 3,548 |
| `src/stdlib/` (TypeScript) | 2,939 |
| `src/formatter/` | 2,239 |
| `src/lsp/` | 1,522 |
| `src/cli/` | 1,073 |
| the rest | 2,393 |

- **Standard library in Istalang:** 3,778 lines of `.ista` under `src/`.
- **Tests:** 220 test files in `src/` with 28,981 lines, plus 14,999 lines of `.ts` and `.ista` in `test/`. Together that is 0.54 times the source.
- **Spec:** 1,838 lines, 36,025 words.
- **The 400-line cap:** 4 files exceed it: `src/compiler/parser/parser.ts` (422), `src/compiler/checker/patterns/matching.ts` (413), `src/compiler/checker/body-checker.ts` (404), `src/runtime/scheduler/segment/index.ts` (402).

### Duplication

Measured with jscpd 4 over `src/**/*.ts`, without `*.test.ts` and `*.test-kit.ts` (618 files, 77,639 lines).

| A clone must be at least | Clones | Duplicated lines |
| --- | --- | --- |
| 6 lines and 60 tokens | 0 | 0% |
| 3 lines and 30 tokens | 58 | 310 (0.4%) |

- At the lower threshold, the 58 clones have 116 ends: `compiler/checker` 51, `compiler/lowering` 15, `formatter` 14, `compiler/parser` 10, `runtime/scheduler` 6, others 20. The largest clone is 15 lines.
- The largest clones checked by hand are boilerplate, not repeated logic:
  - the same import lists in `checker/expressions/operators.ts` and `lowering/expressions/operators.ts`, and in the two `collections.ts`;
  - the same constructor in `runtime/scheduler/slots.ts` and `weak-side.ts`;
  - the tail of an emit loop in `lowering/values/unions.ts`.

  So 0.4% is an upper bound on copied logic.
- jscpd finds only copied text. It can't find one rule implemented twice in different code, such as a conversion rule in both the checker and lowering. Finding those takes a review per subsystem.

## Published sizes of other compilers

| Codebase | Size | Source |
| --- | --- | --- |
| TypeScript, `src/compiler/checker.ts` | 54,434 lines in one file | [architecture overview (third-party mirror)](https://www.mintlify.com/Microsoft/typescript/contributing/architecture-overview); [~50,000 lines](https://www.besthub.dev/articles/uncovering-the-50-000-line-typescript-checker-ts-design-choices-and-performance-impacts-f7ab19dd6066) |
| rustc, crates needed to build it | over 380,000 lines in over 40 crates, in 2020 | [Rust blog, 2020-03-26](https://blog.rust-lang.org/inside-rust/2020/03/26/rustc-dev-guide-overview/) |
| rust-lang/rust, all Rust code | 1.7 million lines (tokei), in 2020 | [rustc-dev-guide PR #765](https://github.com/rust-lang/rustc-dev-guide/pull/765) |
| Go, `src/cmd/compile` | no published figure found | measure it with a checkout (below) |

What these figures support:

- Istalang's checker, 30,638 lines in 203 files, is smaller than TypeScript's `checker.ts` alone.
- TypeScript's checker also covers JavaScript's semantics, which Istalang lacks: classes, inheritance, JSX, narrowing by control flow and declaration files. So the two sizes don't divide into a size per feature; that needs a count per feature.
- The rustc figures are six years old and count different scopes. They show only that rustc was already 4.7 times the size of all of `src/` here in 2020.

## Reproducing

```sh
# source lines, without tests
find src -name '*.ts' ! -name '*.test.*' | xargs cat | wc -l
# per folder
for d in src/*/ src/compiler/*/; do echo "$(find $d -name '*.ts' ! -name '*.test.*' | xargs cat | wc -l) $d"; done | sort -rn
# files over the 400-line cap
find src -name '*.ts' ! -name '*.test.*' | xargs wc -l | awk '$2!="total" && $1>400'
# duplication
npx -y jscpd@4 src --pattern "**/*.ts" --ignore "**/*.test.ts,**/*.test-kit.ts" --min-lines 3 --min-tokens 30 --reporters console
# another compiler, from a checkout
npx -y cloc go/src/cmd/compile --exclude-dir=testdata --not-match-f='_test\.go$'
```
