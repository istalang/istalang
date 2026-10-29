---
description: well-known declarations, static/qualified/extern names, module loading, binder entities and compiler entry points — read before resolving names
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-30
tags: [reuse, language, modules, program, binder, names]
---

# Modules, names and binding

## Units

- list the language's built-in primitive type names → `primitiveNames`, `PrimitiveName` (`src/language/primitives.ts`)
- spell a static function name `Owner.name` (`Time.parse`) → `staticName` (`src/language/static-names.ts`)
- test a name against the naming conventions, its privacy, whether it is the unnamed `_`, or whether a bare name binds in a pattern → `followsConvention`, `Convention`, `isPrivate`, `isUnnamed`, `bindsInPattern` (`src/language/naming.ts`)
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
- look up `dispose`, `from` or `main` function names, or `self`, the parameter making a function a method → `disposeFunction`, `conversionFunction`, `entryFunction`, `receiverParameter` (`src/language/well-known.ts`)
- look up `_inclusiveEnd` or `panic` function names → `inclusiveEndFunction`, `panicFunction` (`src/language/well-known.ts`)
- build a branded `ModuleId` from a `URL` → `moduleIdOf`, `ModuleId` (`src/compiler/program/program.ts`)
- load a `Program` from roots and `ModuleLoader`s (reusing unchanged trees) → `buildProgram`, `Program`, `ModuleLoader` (`src/compiler/program/program.ts`)
- get a loaded `ProgramModule` by `ModuleId` or test for a test/std module → `programModule`, `isTestModule`, `isStdModule` (`src/compiler/program/program.ts`)
- create the project files' `ModuleLoader` or locate a single `.ista` file → `fileLoader`, `locateFile`, `sourceExtension` (`src/project/file-loader.ts`)
- turn a file's absolute path into its module's id, or a module id back into its file → `moduleIdOfFile`, `fileOfModule` (`src/project/file-loader.ts`)
- read project files from disk, or with an editor's open documents laid over them → `ProjectFiles`, `diskFiles`, `overlaidFiles` (`src/project/project-files.ts`)
- find project `.ista` sources or load a project `Program` with stdlib roles, from given files or std sources, reusing a previous snapshot's trees → `loadProject`, `ProjectOptions`, `findProjectSources`, `findSources` (`src/project/project.ts`)
- keep an editor's open texts and the program they make, one load per change → `Workspace`, `ProgramLoader`, `OpenTexts` (`src/language-service/workspace.ts`)
- find the identifier an editor's cursor is on, inside it or right after it → `identifierAt` (`src/language-service/identifier-at.ts`)
- find what a name denotes and where each is declared, or what references and rename act on → `nameAt`, `declarationsOf`, `isSamePlace`, `NamePlace` (`src/language-service/navigation/declarations.ts`)
- list every name of a program denoting a declaration, binder entities, fields, methods and statics alike (the one index of uses, per Program) → `namesDenoting`, `referencesAt` (`src/language-service/navigation/references.ts`)
- rename a declaration across a program, or learn why it is refused → `renamingAt`, `renameEdits` (`src/language-service/navigation/rename.ts`)
- read what an editor's cursor is writing: the name there, the token before it, and whether space parts them → `cursorAt`, `touchingBefore`, `Cursor` (`src/language-service/completion/cursor.ts`)
- find the call whose parentheses a cursor is inside, the argument it writes, the functions the call may call, and the parameter a written argument gives → `callAt`, `calleesOf`, `writtenParameter` (`src/language-service/call-at.ts`)
- tell what the grammar admits at a cursor (a type, a declared name, a pattern, a call's argument, a member…) → `placeAt`, `Place` (`src/language-service/completion/place.ts`), which reads all but members and literal fields from a parse with a placeholder name there (`parsedPlaceAt`, `placeholder.ts`)
- offer the names visible at a cursor and every keyword, as completion candidates → `visibleCandidates` (`src/language-service/completion/visible.ts`)
- turn completion candidates into items, or an item into an LSP item → `present` (`src/language-service/completion/present.ts`), `completionItem` (`src/lsp/providers/completion.ts`)
- read an LSP request's position as a module and offset, or write a name's place as an LSP location → `documentOffset`, `locationOf`, `rangeOf` (`src/lsp/locations.ts`)
- get a module of a program, its tree and the program's checker, for an editor feature reading types → `checkedModule` (`src/language-service/checked-module.ts`)
- find the module a namespace import loaded → `importedModule` (`src/language-service/namespaces.ts`)
- bind a `Program`'s names (memoized per `Program` and per `SyntaxTree`) → `bindProgram` (`src/compiler/binder/bind.ts`)
- make an entity, once per node it stands for, so it outlives edits elsewhere → `variableEntity`, `ownCallEntity`, `typeEntity`, `selfEntity`, `variantEntity`, `namespaceEntity`, `functionsEntity` (`src/compiler/binder/entities.ts`); an import's placeholder → `importPlaceholder` (`src/compiler/binder/scope.ts`)
- resolve what an `Identifier` denotes or list a module's exports → `Bindings.entityOf`, `Bindings.exportsOf` (`src/compiler/binder/entities.ts`)
- resolve a name a body uses where it is written, noting closure captures → `BodyContext.useEntity`; only ask → `BodyContext.entityOf` (`src/compiler/checker/context.ts`)
- find an entity's declaring module, locals included, tell a top-level name apart, or join prelude overloads → `Bindings.moduleOf`, `Bindings.isTopLevel`, `Bindings.overloadsOf` (`src/compiler/binder/entities.ts`)
- list the names visible at an offset, each with what it denotes there → `Bindings.visibleAt` (`src/compiler/binder/entities.ts`)
- find the module declaring any declaration, a local one included → `Checker.moduleOf` (`src/compiler/checker/declaring-modules.ts`)
- read a module's items, imports, roles or tree, or the bare variant an expected enum chooses, inside the checker → `CheckerContext.inputs` (`src/compiler/checker/program-inputs.ts`); whether a module is std → `Checker.isStd`
- ask what an identifier denotes, the body holding a node, a written type's type or a type's members (tools, by position) → `Checker.lookup` (`src/compiler/checker/denotation.ts`)
- list bare variant candidates or look up a top-level/prelude name → `Bindings.candidatesOf`, `Bindings.topLevelNamed` (`src/compiler/binder/entities.ts`)
- find the hidden variable an async function holds its own call in, which its name before a `.` reads (§7) → `Bindings.ownCallOf` (`src/compiler/binder/entities.ts`)
- check whether a `VariableEntity` is the own name of a local `fn` or named `Lambda` → `localFunctionOf` (`src/compiler/binder/entities.ts`)
- collect all phase diagnostics or compile a program or its tests to a `Definition` → `diagnose`, `compileProgram`, `compileTests` (`src/compiler/compile.ts`)

## One-way rules

- Never spell a language-known module, declaration, variant, annotation or protocol function as a string literal; import it from `src/language/well-known.ts`.
- Spell `Owner.name` with `staticName`, `module.name` with `qualifiedName`, and extern keys with `externKey` (`src/definition/extern-key.ts`).
- `Program` loading does no I/O and imposes no path syntax; only `src/compiler/compile.ts` coordinates phases after `buildProgram`.
