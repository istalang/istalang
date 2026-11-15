---
description: well-known declarations, static/qualified/extern names, module loading, binder entities and compiler entry points — read before resolving names
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-15
tags: [reuse, language, modules, program, binder, names]
---

# Modules, names and binding

## Units

- list the language's built-in primitive type names, or the one a lowercase leftover (`int`) became → `primitiveNames`, `PrimitiveName`, `primitiveOnceSpelled` (`src/foundation/language/primitives.ts`)
- spell a static function name `Owner.name` (`Time.parse`) → `staticName` (`src/foundation/language/static-names.ts`)
- test a name against the naming conventions, its privacy, whether it is the unnamed `_`, whether a bare name binds in a pattern, whether it is cased as a type's (as an expression's `<…>` asks of its names), or whether a built-in type takes it → `followsConvention`, `Convention`, `isPrivate`, `isUnnamed`, `bindsInPattern`, `casedAsType`, `isBuiltInTypeName` (`src/foundation/language/naming.ts`)
- spell a module-qualified declaration name `module.name` (`prelude.Future`) → `qualifiedName` (`src/foundation/language/well-known/index.ts`)
- spell a checked declaration's module-qualified name, or a type's table key (its checker key with qualified names for numbers: what a Definition orders union variants by and names variants, instances and structural entries by, alike however the type was written and whatever else the program declares) → `qualifiedNameOf`, `declaredNameOf`, `tableKey` (`src/compiler/lowering/tables/names.ts`); an extern's or startable function's key, or a host extern's declared type, a frozen projection of types → `keyOf`, `declaredTypeOf` (`src/compiler/lowering/tables/extern-keys.ts`), its bytes held by `extern-keys.sweep.test.ts`
- build an extern key (`prelude.add(Int, Float)`) from a signature or native table → `externKey`, `nativeKey`, `keyTypeText` (`src/definition/extern-key.ts`)
- build type descriptors for `nativeKey` → `namedKey`, `functionKey`, `tupleKey`, `parameterKey` (a primitive by its name) (`src/definition/extern-key.ts`)
- mark a `nativeKey` parameter as `&` reference or `...` rest → `referenceKey`, `restKey` (`src/definition/extern-key.ts`)
- look up a language-role module (`prelude`, `time`, `json`, `lifetimes`, `testing`), the `std:` scheme, or a well-known declaration (`wellKnown.holds`, `wellKnown.keeps` among them) → `languageModules`, `stdScheme`, `wellKnown` (`src/foundation/language/well-known/index.ts`)
- look up well-known variant and field names (a union's layout, `Result`, a cursor's `Step`) → `unionLayout`, `resultVariants`, `resultFields`, `stepVariants` (`src/foundation/language/well-known/variants.ts`); `Json` is a union, whose members json-values.ts finds by what each variant holds
- look up well-known codec function names and helpers → `codecFunctions`, `derivedCodecs`, `codecHelpers`, `writeThrough` (`json.encode`, what lowering's write call is) (`src/foundation/language/well-known/codecs.ts`)
- look up well-known testing function names, the test file suffix, or whether a path names a test module → `testingFunctions`, `testModuleSuffix`, `isTestModulePath` (`src/foundation/language/well-known/testing.ts`)
- look up collection, template, pattern or await function names → `collectionFunctions`, `templateFunctions`, `arrayPatternFunctions`, `awaitFunction` (`src/foundation/language/well-known/implicit-calls.ts`); the prelude's `Resolver` → `wellKnown.resolver`
- look up `dispose`, `from` or `main` function names, or `self`, the parameter making a function a method, or `Self`, the type meeting a trait → `disposeFunction`, `conversionFunction` (`src/foundation/language/well-known/implicit-calls.ts`), `entryFunction`, `receiverParameter`, `selfType` (`src/foundation/language/well-known/index.ts`)
- look up `_inclusiveRange` or `panic` function names → `inclusiveRangeFunction`, `panicFunction` (`src/foundation/language/well-known/implicit-calls.ts`)
- build a branded `ModuleId` from a `URL` → `moduleIdOf`, `ModuleId` (`src/compiler/program/program.ts`)
- load a `Program` from roots and `ModuleLoader`s (reusing unchanged trees) → `buildProgram`, `Program`, `ModuleLoader` (`src/compiler/program/program.ts`)
- get a loaded `ProgramModule` by `ModuleId` or test for a test/std module → `programModule`, `isTestModule`, `isStdModule` (`src/compiler/program/program.ts`)
- create the project files' `ModuleLoader` or locate a single `.ista` file → `fileLoader`, `locateFile`, `sourceExtension` (`src/project/file-loader.ts`)
- turn a file's absolute path into its module's id, or a module id back into its file → `moduleIdOfFile`, `fileOfModule` (`src/project/file-loader.ts`)
- read project files from disk, or with an editor's open documents laid over them → `ProjectFiles`, `diskFiles`, `overlaidFiles` (`src/project/project-files.ts`)
- read an import's path in the toolchain's one syntax: the `.`/`..` it starts with and the names after, or that it is no path → `importPathOf`, `ImportPath` (`src/foundation/language/import-paths.ts`)
- find project `.ista` sources or load a project `Program` with stdlib roles, from given files or std sources, reusing a previous snapshot's trees → `loadProject`, `ProjectOptions`, `findProjectSources`, `findSources` (`src/project/project.ts`)
- keep an editor's open texts and the program they make, one load per change → `Workspace`, `ProgramLoader`, `OpenTexts` (`src/editor/language-service/workspace.ts`)
- find the identifier, or the String literal, an editor's cursor is on, inside it or right after it → `identifierAt`, `stringLiteralAt` (`src/editor/language-service/reading/identifier-at.ts`)
- find what a name denotes and where each is declared, or what references and rename act on → `nameAt` (its declarations for going to a definition, its targets for references and rename), `actedOnBy` (a name reached through a renaming import acts on the import's alias, `Bindings.aliasOf`), `isSamePlace`, `NamePlace`, `WrittenName`/`spelledName` (an identifier, or a String literal naming a field as its key) (`src/editor/language-service/navigation/declarations.ts`); the field a key literal names → `lookup.keyDenotationsOf`, and the field of a known key owner a key names, as an indented map's bare key reads (`bareKeyOf`) → `keyedFieldDenotations` (`src/compiler/checker/lookup/key-denotations.ts`), reading what checking recorded (`CheckedBody.keyOwnerOf`; a new place where the checker decides a literal is a key records it through `BodyContext.recordKey`, with `keysOwner`/`givenKeysOwner` in `types/written/key-types.ts` and `keyOwnerOfValue` in `types/traits/struct-keys.ts`), never reconstructing it from where the literal stands
- list every name of a program denoting a declaration, binder entities, fields, methods and statics alike (the one index of uses, per Program) → `namesDenoting`, `referencesAt` (`src/editor/language-service/navigation/references.ts`)
- rename a declaration across a program, or learn why it is refused → `renamingAt`, `renameEdits` (`src/editor/language-service/navigation/rename.ts`), the key literals naming a field among its names
- read what an editor's cursor is writing: the name there, the token before it, and whether space parts them, or only spaces and tabs (also between any token and an offset) → `cursorAt`, `touchingBefore`, `adjoinsBefore`, `adjoins`, `Cursor` (`src/editor/language-service/completion/cursor.ts`)
- find the call whose parentheses a cursor is inside, the argument it writes, the functions the call may call, and the parameter a written argument gives → `callAt`, `calleesOf`, `writtenParameter` (`src/editor/language-service/signatures/call-at.ts`)
- tell what the grammar admits at a cursor (a type, a declared name, a pattern, a call's argument, a member…) → `placeAt`, `Place` (`src/editor/language-service/completion/place.ts`), which reads all but members and literal fields from a parse with a placeholder name there (`parsedPlaceAt`, `placeholder.ts`)
- offer the names visible at a cursor, every one or those a place keeps, as completion candidates → `visibleNames` (`src/editor/language-service/completion/visible.ts`)
- offer what an expression may start with at a completion place: the names that are values and the words an operand starts with in the body around it → `expressionCandidates` (`src/editor/language-service/completion/places/grammar/expression.ts`)
- ask the checker about a node of completion's placeholder parse (one ending before the cursor) → a tentative check, as `expectedTypeAt` (`src/editor/language-service/completion/expected.ts`) makes one
- the type a `case`, `is` or parameter pattern being written matches, or the fields its struct pattern names → `matchedTypeOf`, `fieldsMatchedBy` (`src/editor/language-service/completion/places/patterns/matched-type.ts`); a second pattern walk the checker should record instead: extend the checker's pattern walk, never this (`docs/audit/dry-review-2026-11-13.md` finding 3)
- offer the module paths an import's path may go on with, one segment at a time, from the importer or the project root → `modulePathsAt` (`src/editor/language-service/completion/places/imports/module-paths.ts`)
- tell whether a type may annotate (§3.16: a struct, not a shared or extern one) → `canAnnotate`; where a function stands for its annotations, extern or not → `functionPlace` (`src/compiler/checker/surface/checked-annotation.ts`)
- what the std's externs hold and keep (§3.16): a value of an extern type one level down → `Checker.externHeldOf`; an extern function's parameters, by position → `Checker.keepsOf`, its unknown names reported by `checkKeeps` (`src/compiler/checker/rules/lifetimes/externs.ts`)
- tell a declaration that takes type parameters, which its annotations see → `isGenericDeclaration`, `GenericDeclaration` (`src/compiler/syntax/declarations/index.ts`)
- turn completion candidates into items, or an item into an LSP item → `present` (`src/editor/language-service/completion/presentation/present.ts`)
- the type expected where a cursor writes a value, and the variants that may be written bare there → `expectedTypeAt`, `expectedVariants`, `isBareVariant` (`src/editor/language-service/completion/expected.ts`)
- read a checked body at a node as tools do, the passes of the field loops around it read as one (§4) → `checker.lookup.bodyHolding`, a `JoinedBody` (`src/compiler/checker/surface/denotation.ts`): its types joined, and every pass's call or lambda listed (`callsAt`, `functionsOf`); never a pass's single call, which lowering alone reads; a checker layer beneath `lookup` reads it alike → `bodyHolding` (`src/compiler/checker/contexts/holding-body.ts`)
- the type expected of a value in a checked body → `CheckedBody.expectedOf`; whether a type fits another → `Checker.fitOf` (`src/compiler/checker/check.ts`)
- check an edit tried out without cutting the program's incremental history → `checkProgram(program, { previous, tentative: true })`
- the docstring of what a name denotes → `docstringOf` (`src/editor/language-service/reading/docstrings.ts`)
- the order completion items sort in → `rankKeys`, `ranksBefore` (`src/editor/language-service/completion/presentation/item.ts`)
- read an LSP request's URI/position/range as a module, offset or span, or write a place/span as an LSP location/range → `moduleIdOfUri`, `documentOffset`, `spanOf`, `locationOf`, `rangeOf` (`src/editor/lsp/locations.ts`)
- get a module of a program, its tree and the program's checker, for an editor feature reading types → `checkedModule` (`src/editor/language-service/reading/checked-module.ts`)
- find the module a namespace import loaded → `importedModule` (`src/editor/language-service/reading/namespaces.ts`)
- bind a `Program`'s names (memoized per `Program` and per `SyntaxTree`) → `bindProgram` (`src/compiler/binder/bind.ts`)
- make an entity, once per node it stands for, so it outlives edits elsewhere → `variableEntity`, `ownCallEntity`, `typeEntity`, `selfEntity`, `variantEntity`, `namespaceEntity`, `functionsEntity` (`src/compiler/binder/entities.ts`); an import's placeholder, one per imported name → `importPlaceholder` (`src/compiler/binder/module/scope.ts`)
- read a named import's names: the name each binds, its alias or the export's, and the names recovery left whole → `boundName`, `importedNames` (`src/compiler/syntax/declarations/index.ts`); never read `NamedImport.names` as identifiers
- tell whether a name reaches its entity through a renaming import (`import a as b`), and by which alias → `Bindings.aliasOf` (`src/compiler/binder/entities.ts`)
- resolve what an `Identifier` denotes or list a module's exports → `Bindings.entityOf`, `Bindings.exportsOf` (`src/compiler/binder/entities.ts`)
- resolve a name a body uses where it is written, noting closure captures → `BodyContext.useEntity`; only ask → `BodyContext.entityOf` (`src/compiler/checker/contexts/body-context.ts`)
- find an entity's declaring module, locals included, tell a top-level name apart, or join prelude overloads → `Bindings.moduleOf`, `Bindings.isTopLevel`, `Bindings.overloadsOf` (`src/compiler/binder/entities.ts`)
- list the names visible at an offset, each with what it denotes there → `Bindings.visibleAt` (`src/compiler/binder/entities.ts`)
- bind code that sees its functions' types but none of their variables, a transient's initializer (§3.4), each hidden name explained, an enclosing function's own call among them (§7) → `Scope.fenced`, `Scope.enclosingOf` (`src/compiler/binder/module/scope.ts`)
- find the module declaring any declaration, a local one included → `Checker.moduleOf` (`src/compiler/checker/wiring/program/program-inputs.ts`, `DeclaringModules`)
- read a module's items, imports, roles or tree, or the bare variant an expected enum chooses, inside the checker → `CheckerContext.inputs` (`src/compiler/checker/wiring/program/program-inputs.ts`); whether a module is std → `Checker.isStd`
- ask what an identifier denotes, the body holding a node, a written type's type or a type's members (tools, by position) → `Checker.lookup` (`src/compiler/checker/surface/denotation.ts`)
- list bare variant candidates, look up a top-level/prelude name, or list every one → `Bindings.candidatesOf`, `Bindings.topLevelNamed`, `Bindings.topLevelNames` (`src/compiler/binder/entities.ts`)
- find the hidden variable an async function holds its own call in, which its name before a `.` reads (§7) → `Bindings.ownCallOf` (`src/compiler/binder/entities.ts`)
- check whether a `VariableEntity` is the own name of a local `fn` or named `Lambda` → `localFunctionOf` (`src/compiler/binder/entities.ts`)
- tell an entity that is a type, as a name in a type must be, from the rest → `namesType` (`src/compiler/binder/entities.ts`)
- ask whether names may follow an entity and a dot (a namespace, or an enum's variants) → `qualifies`, `Qualifier`, and `isAlias` for an alias that may stand for one (`src/compiler/binder/entities.ts`); once linked, what an entity qualifies through, an alias of an enum the enum → `qualifierOf` (`src/compiler/binder/link/qualifiers.ts`)
- collect all phase diagnostics or compile a program or its tests to a `Definition` → `diagnose`, `compileProgram`, `compileTests` (`src/compiler/compile.ts`)

## One-way rules

- Never spell a language-known module, declaration, variant, annotation or protocol function as a string literal; import it from `src/foundation/language/well-known/index.ts`.
- Ask whether a name is the unnamed `_` with `isUnnamed`, whether a bare pattern name binds with `bindsInPattern`, and whether a name is cased as a type's with `casedAsType` (`src/foundation/language/naming.ts`); never compare against `'_'` or test a letter's case by hand.
- Spell `Owner.name` with `staticName`, `module.name` with `qualifiedName`, and extern keys with `externKey` (`src/definition/extern-key.ts`).
- `Program` loading does no I/O and imposes no path syntax; only `src/compiler/compile.ts` coordinates phases after `buildProgram`.
