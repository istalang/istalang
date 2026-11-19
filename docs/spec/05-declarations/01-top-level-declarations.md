---
description: what a program's top level may hold and which values top-level constants may compute; read before adding a kind of declaration
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 5.1 Top-level declarations

A program consists only of top-level declarations: imports, structs, enums, traits, type aliases, functions, `extern` declarations, and `const` values computable at compile time (literals, `none`, lambdas, and tuples, structs, arrays and maps built from them, in any literal form, each put into a union where one is expected, indented values (§3.2) among them, a field left to its default (§5.2) computed as its default is; a spread there spreads another array or map so built; never a shared struct, whose cell lives in an instance (§5.4)). A lambda there reads other constants but captures nothing, so it is a function value made once (§6.4). A top-level `const` may destructure its value as a local one does (§4.5), each name a constant of its own. A context constant, `ista const`, holds one value per context instead (§7.1). There are no top-level variables or statements.
