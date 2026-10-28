---
description: well-known declarations, static/qualified/extern names, module loading, binder entities and compiler entry points — read before resolving names
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [reuse, language, modules, program, binder, names]
---

# Modules, names and binding

## Units

- list the language's built-in primitive type names → `primitiveNames`, `PrimitiveName` (`src/language/primitives.ts`)
- spell a static function name `Owner.name` (`Time.parse`) → `staticName` (`src/language/static-names.ts`)
- spell a module-qualified declaration name `module.name` (`prelude.Future`) → `qualifiedName` (`src/language/well-known.ts`)
- spell a checked declaration's module-qualified name or extern/startable key → `qualifiedNameOf`, `keyOf`, `spelledType` (`src/compiler/lowering/names.ts`)
- build an extern key (`prelude.add(int, float)`) from a signature or native table → `externKey`, `nativeKey`, `keyTypeText` (`src/definition/extern-key.ts`)
- build type descriptors for `nativeKey` → `namedKey`, `primitiveKey`, `functionKey`, `parameterKey` (`src/definition/extern-key.ts`)
- mark a `nativeKey` parameter as `&` reference or `...` rest → `referenceKey`, `restKey` (`src/definition/extern-key.ts`)
- look up a language-role module (`prelude`, `time`, `json`, `testing`) or declaration → `languageModules`, `wellKnown` (`src/language/well-known.ts`)
- look up well-known variant names (`Optional`, `Result`, `Json`) → `optionalVariants`, `resultVariants`, `jsonVariants` (`src/language/well-known.ts`)
- look up well-known codec function names and helpers → `codecFunctions`, `derivedCodecs`, `codecHelpers` (`src/language/well-known.ts`)
- look up well-known testing function names, the test file suffix, or whether a path names a test module → `testingFunctions`, `testModuleSuffix`, `isTestModulePath` (`src/language/well-known.ts`)
- look up collection, template or pattern function names → `collectionFunctions`, `templateFunctions`, `arrayPatternFunctions` (`src/language/well-known.ts`)
- look up `dispose`, `from` or `main` function names → `disposeFunction`, `conversionFunction`, `entryFunction` (`src/language/well-known.ts`)
- look up `_inclusiveEnd` or `panic` function names → `inclusiveEndFunction`, `panicFunction` (`src/language/well-known.ts`)
- build a branded `ModuleId` from a `URL` → `moduleIdOf`, `ModuleId` (`src/compiler/program/program.ts`)
- load a `Program` from roots and `ModuleLoader`s (reusing unchanged trees) → `buildProgram`, `Program`, `ModuleLoader` (`src/compiler/program/program.ts`)
- get a loaded `ProgramModule` by `ModuleId` or test for a test/std module → `programModule`, `isTestModule`, `isStdModule` (`src/compiler/program/program.ts`)
- create a disk `ModuleLoader` or locate a single `.ista` file on disk → `fileLoader`, `locateFile`, `sourceExtension` (`src/cli/file-loader.ts`)
- find project `.ista` sources or load a project `Program` with stdlib roles → `loadProject`, `findProjectSources`, `findSources` (`src/cli/project.ts`)
- bind a `Program`'s names (memoized per `Program` and per `SyntaxTree`) → `bindProgram` (`src/compiler/binder/bind.ts`)
- resolve what an `Identifier` denotes or list a module's exports → `Bindings.entityOf`, `Bindings.exportsOf` (`src/compiler/binder/entities.ts`)
- find an entity's declaring module or join prelude overloads → `Bindings.moduleOf`, `Bindings.overloadsOf` (`src/compiler/binder/entities.ts`)
- list bare variant candidates or look up a top-level/prelude name → `Bindings.candidatesOf`, `Bindings.topLevelNamed` (`src/compiler/binder/entities.ts`)
- check whether a `VariableEntity` is the own name of a local `fn` or named `Lambda` → `localFunctionOf` (`src/compiler/binder/entities.ts`)
- collect all phase diagnostics or compile a program or its tests to a `Definition` → `diagnose`, `compileProgram`, `compileTests` (`src/compiler/compile.ts`)

## One-way rules

- Never spell a language-known module, declaration, variant, annotation or protocol function as a string literal; import it from `src/language/well-known.ts`.
- Spell `Owner.name` with `staticName`, `module.name` with `qualifiedName`, and extern keys with `externKey` (`src/definition/extern-key.ts`).
- `Program` loading does no I/O and imposes no path syntax; only `src/compiler/compile.ts` coordinates phases after `buildProgram`.
