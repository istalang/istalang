---
description: modules, exports, imports, paths, project sources, argument-dependent lookup, the prelude's names; read before changing imports or name lookup
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 13.1 Modules

A program is made of modules, one per file; source files use the `.ista` extension. The compiler merges the entry module and everything it imports, directly or transitively, into a single definition. A program's code therefore never changes partially: a deploy always replaces the whole set. Code from other projects comes in as packages (§13.2).

```ista
import approve, Verdict from 'purchase/approve'
import (
    approvePurchaseRequest
    rejectPurchaseRequest
    PurchaseVerdict
    notifyReviewers as notify             # bound as `notify`
) from 'purchase/requests'
import * as runtime from 'runtime'

fn _normalize(id: String) -> String:     # private to this module
    ...
```

- **Exports.** Every top-level declaration is exported, except names starting with `_`, which only a test module (§18) may also name, from the modules it imports. There are no default exports, and imported names are not re-exported.
- **Imports.** `import a, b from 'path'` brings named exports into scope, its items on the import's line. In parentheses, `import (a, b) from 'path'`, they are a list (§2.1), which may span lines, with no `,` at a line's end. In either form an item is one of:
  - `name`, or `name as alias`, which binds the export `name` as `alias`; only the alias is in scope, so one export may be bound under several names;
  - `* as m`, which binds the module as a namespace, used as `m.name`;
  - `*`, which binds every export under its own name, as if the import listed each. The names starting with `_` aren't exports, so it binds none of them, even in a test module.

  So `import (* as json, encode, decode) from 'json'` binds `json`, `encode` and `decode`. A name bound twice by imports that name it, or clashing with a local declaration, is a compile error. A name a `*` brings that something else gives too, another `*`, a declaration or import of the module, or the prelude, is an error only where it is used, as ambiguous: nothing shadows implicitly, and a module adding an export breaks no importer that doesn't use it. Two ways to the same export are one, and a function a `*` brings joins the prelude's overloads of its name, as one imported by name does.
- **Paths.** Each path must name exactly one module: a path that names none, or several, is a compile error. Which module a path names is decided by the module loaders of whatever runs the compiler, much as a bundler resolves imports, so a host may use its own paths and its own module store.
- **The toolchain's paths.** The `ista` toolchain resolves a path as names separated by `/`, with the `.ista` extension implied. A path starting with `./` or `../` is relative to the importing file. Any other path names a standard-library module, or a module under the project root, the directory the toolchain runs in. A path that matches both a standard-library module and a project file is therefore an error.
- **Project sources.** Without explicit files, `ista check` checks every `.ista` file under the project root, skipping the project's `vendor/` folder (§13.2), every `node_modules/` folder and hidden directories.
- **Cycles.** Modules contain only declarations, never top-level code, so import cycles are allowed.
- **Argument-dependent lookup.** A function is also found through the modules that declare its arguments' types. `a + b` on two `Duration`s finds `add` in `Duration`'s module without an explicit import. Only the arguments' own types count, not their type arguments, so `Inbox<T>`, a handle the `inbox` module declares (§5.4), finds that module's functions, while an `Array<Duration>` doesn't find `Duration`'s. Only exported functions are found this way, and a call through a namespace (`m.f(x)`) looks only in `m`. A shape (§5.2) or a union (§4.2) has no module, so argument-dependent lookup finds nothing for it: its functions are found as any function is, by import.
- **Externs** are bound by module-qualified name, so two modules can declare externs with the same short name.
- **The prelude** is imported implicitly into every module. A module's top-level declarations and the names its imports bind can't reuse a prelude name, with one exception: a top-level function, declared or imported under its own name, joins the prelude's overloads of its name, as `fn add(left: Time, right: Duration)` does (§10.2). A function imported under another name joins nothing, so an alias can't take a prelude name.
