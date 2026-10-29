---
description: Completion scenarios — silence, triggers, item shape, resilience, the VS Code client; each scenario's snippet, trigger, expected items, what accepting inserts, and today's status through ista lsp; read when changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [plan, completion, lsp]
---

# Completion scenarios: silence, triggers, item shape, resilience, the VS Code client

Conventions, fixture and legend: `scenarios.md`. Status is ✅ when the probe's assertions for the scenario hold today, ❌ when any fails (`Today` gives the first reasons).

## NO: Where nothing is offered

Positions with no valid completion: the list is empty, whatever opened it. (An empty list is also the only answer a server can give to the client's word-based fallback, VC-01.)

### NO-01 · Inside a comment · P1 · ❌ fail

```
  # note ‸
---
  const a = 1  # use ‸
---
# top ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** spec §2 (`#` comments); TS offers nothing in comments.
- **Today:** #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 offered 185: Red,Green,Blue,Approved,Rej…; #3 offered 184: Red,Green,Blue,Approved,Rej…

### NO-02 · Inside a string · P1 · ❌ fail

```
  const s = "ab‸"
---
  const s = 'ab‸'
---
  const s = "ab‸
---
  const s = "a\n‸"
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** spec §2; VS Code's `editor.quickSuggestions.strings` is off, but invoked/trigger requests reach the server.
- **Today:** #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 offered 184: Red,Green,Blue,Approved,Rej…; #3 offered 185: Red,Green,Blue,Approved,Rej…; #4 offered 184: Red,Green,Blue,Approved,Rej…

### NO-03 · Inside a number · P2 · ❌ fail

```
  const a = 12‸
---
  const a = 0x1‸
---
  const a = 1_‸
---
  const a = 3.1‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing (a duration suffix `5d` is typed: `ms s m h d`, P3 optional).
- **Not:** Names.
- **Basis:** a name glued to a number is no token.
- **Today:** #1 offered 185: Red,Green,Blue,Approved,Rej…; #2 offered 185: Red,Green,Blue,Approved,Rej…; #3 offered 185: Red,Green,Blue,Approved,Rej…; #4 offered 185: Red,Green,Blue,Approved,Rej…

### NO-05 · Dot where no member can stand · P1 · ✅ pass

```
  1 + p.‸
---
  nope.‸
---
  "a" .‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The first: `p`'s members; the others: only what exists (ME-12).
- **Not:** Scope names, keywords.
- **Basis:** spec §4.

### NO-06 · Triggers outside their positions · P1 · ✅ pass

```
  const a = [1, ‸
---
  const f = fn(a, ‸
---
  struct S { a: int, ‸
---
fn g(a: int, ‸
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** Nothing: `,` in an array, a parameter list or a declaration is no literal.
- **Not:** Scope names.
- **Basis:** LSP trigger only narrows where its meaning is known.

### NO-07 · After a closing bracket, adjacent · P3 · ❌ fail

```
  plus(1)‸
---
  xs[0]‸
---
  [1]‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Names.
- **Basis:** a name glued to `)` is no token.
- **Today:** #1 unexpected xs; #1 unexpected plus; #1 unexpected let; #2 unexpected xs; #2 unexpected plus; #2 unexpected let; #3 unexpected xs; #3 unexpected plus; #3 unexpected let

### NO-08 · Space trigger elsewhere · P1 · ❌ fail

```
  const a = 1 ‸
---
  if n: ‸
---
  return ‸
---
fn g() ‸
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** Nothing: a typed space opens a list only where LI-03/CA-03b/LI-07 say; everywhere else it must stay silent.
- **Not:** Anything.
- **Basis:** a trigger character that opens noise everywhere would pop a list after every space.
- **Today:** #1 ' ' is not a trigger character; #1 offered 185: Red,Green,Blue,Approved,Rej…; #2 ' ' is not a trigger character; #2 offered 184: Red,Green,Blue,Approved,Rej…; #3 ' ' is not a trigger character; #3 offered 184: Red,Green,Blue…

### NO-09 · Block-opening colon · P3 · ❌ fail

```
  if n:‸
---
fn g():‸
```
- **Where / trigger:** in `fn t`; typing `:`
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** spec §4.
- **Today:** #1 ':' is not a trigger character; #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 ':' is not a trigger character; #2 offered 173: Red,Green,Blue,Approved,Rej…

## TR: Opening and staying open

How a list opens (invoked, trigger characters, typing on) and what the server must declare for the client to keep it open.

### TR-01 · Members open on `.` · P1 · ✅ pass

```
  p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01.
- **Basis:** LSP triggerCharacters.

### TR-02 · Members open on the `>` of `->` · P1 · ✅ pass

```
  l->‸
```
- **Where / trigger:** in `fn t`; typing `>`
- **Offer:** ME-06.
- **Basis:** as TR-01.

### TR-03 · Fields open on `{` in a literal · P1 · ✅ pass

```
  Pair{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** LI-01.
- **Basis:** as TR-01.

### TR-04 · Fields open on `,` in a literal · P1 · ✅ pass

```
  Pair{first: 1,‸}
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** LI-02.
- **Basis:** as TR-01.

### TR-05 · …and stay open when the space is typed · P1 · ❌ fail

```
  Pair{first: 1, ‸}
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** LI-03: the server declares ` ` as a trigger character.
- **Basis:** VS Code closes a list on a non-word character that is not a trigger.
- **Today:** ' ' is not a trigger character

### TR-06 · Declared trigger characters · P1 · ❌ fail

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The server declares `.`, `>`, `{`, `,`, ` `, `@`, `'`, `"`, `/` (`:` and `(` are not needed: the field item re-triggers, signature help owns `(`).
- **Basis:** LSP CompletionOptions.triggerCharacters.
- **Today:** not declared: ' ' '@' ''' '"' '/'

### TR-07 · Invoked and trigger lists agree · P1 · ✅ pass

```
  Pair{‸}
---
  Pair{‸}   ⟵ typing "{"
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The list when invoked equals the list on the trigger character: one candidate set per position, the client filters.
- **Not:** A trigger list narrower than the invoked one (that hides items a letter then asks for).
- **Basis:** LSP: a list the client already holds is filtered, not asked again, unless `isIncomplete`.

### TR-07b · Invoked and trigger lists agree after a comma · P1 · ✅ pass

```
  Pair{first: 1, ‸}
---
  Pair{first: 1,‸}   ⟵ typing ","
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TR-07.
- **Not:** As TR-07.
- **Basis:** as TR-07.

### TR-08 · The list does not depend on the typed prefix · P1 · ✅ pass

```
  p.‸
---
  p.f‸
---
  p.first‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The same items at every prefix (the client matches).
- **Not:** Server-side filtering.
- **Basis:** LSP `isIncomplete: false` contract.

### TR-08b · Prefix independence in a literal · P1 · ✅ pass

```
  Pair{first: 1, ‸}
---
  Pair{first: 1, s‸}
---
  Pair{first: 1, zzz‸}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The same items at every prefix.
- **Not:** Server-side filtering.
- **Basis:** as TR-08.

### TR-09 · Accepting a field re-opens a list · P1 · ❌ fail

```
  Pair{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** The item has `command: editor.action.triggerSuggest` (LI-01).
- **Basis:** LSP `CompletionItem.command`; used by TS/RA/clangd to chain completions.
- **Today:** first doesn't re-trigger; second doesn't re-trigger

### TR-10 · Accepting a named argument re-opens a list · P1 · ❌ fail

```
  plus(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TR-09 for `a: `.
- **Basis:** as TR-09.
- **Today:** missing a:

### TR-11 · Accepting a method opens signature help · P3 · ❌ fail

```
  p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The method inserts `sum($0)` with `command: editor.action.triggerParameterHints` (when it has parameters).
- **Basis:** VS Code convention (TS `completeFunctionCalls`, RA `callable.snippets`).
- **Today:** no parameter-hints command

### TR-12 · Commit characters · P3 · ❌ fail

```
  Pair‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Types, namespaces, variables commit on `.`; functions/methods on `(` unless their insert text holds it; field and argument names (which insert `: `) commit on nothing.
- **Not:** A commit character that mangles the inserted text.
- **Basis:** LSP `commitCharacters`, VS Code `acceptSuggestionOnCommitCharacter`.
- **Today:** `time` has no `.` commit character

## OR: Item shape, order, kinds

What an item carries beyond its label: insert text, detail, kind, sort order, preselect.

### OR-01 · Names rank by nearness · P1 · ❌ fail

```
  const loc = 1
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Locals and parameters, then module-level names, then imported namespaces, then the prelude, then keywords (`sortText` buckets).
- **Not:** Keywords above names; prelude noise above the file's own names.
- **Order:** `loc`, `xs` … before `plus`, `Pair` … before `Array`, `Some` … before `fn`, `while`.
- **Basis:** VS Code sorts by `sortText`, then label; TS (location priority), RA (relevance).
- **Today:** xs ranks after plus; plus ranks after Array; plus ranks after fn

### OR-02 · Members rank fields first, then methods · P3 · ✅ pass

```
  p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01.
- **Order:** `first`, `second`, then `sum`.
- **Basis:** RA, Kotlin.

### OR-03 · Kinds · P3 · ❌ fail

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Struct → Struct, enum → Enum, trait → Interface, alias → Class, primitive → Keyword, variant → EnumMember, function → Function, local → Variable, constant → Constant, namespace → Module, type parameter → TypeParameter.
- **Not:** Every type as Class.
- **Basis:** LSP CompletionItemKind; VS Code icons.
- **Today:** Pair kind 7 ≠ 22; Color kind 7 ≠ 13; Shape kind 7 ≠ 8

### OR-04 · Detail · P2 · ❌ fail

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Variables show their type (`xs` → `Array<int>`), functions their signature, types their kind.
- **Not:** Missing detail.
- **Basis:** LSP `detail`; hover knows the types.
- **Today:** xs detail undefined ≠ "Array<int>"; p detail undefined ≠ "Pair"

### OR-05 · Function insert text · P3 · ❌ fail

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `plus` inserts `plus($0)`; with an existing `(` after the cursor, `plus`.
- **Basis:** RA `callable.snippets`, TS `completeFunctionCalls`.
- **Today:** plus inserts "plus" ≠ "plus($0)"

### OR-06 · Docs on resolve · P3 · ❌ fail

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Items carry the declaration's doc comment (`resolveProvider` and `completionItem/resolve`, or `documentation`).
- **Basis:** LSP resolve; hover already shows docstrings.
- **Today:** no docs, no resolveProvider

### OR-07 · One entry per name · P2 · ✅ pass

```
  ‸
---
  p.‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Each label once (overloads merged, shadowed names once).
- **Not:** Duplicates.
- **Basis:** SC-16.

## RB: Resilience

Completion mid-edit, in broken code, on odd text, and over the protocol.

### RB-01 · Empty function body at the end of the file · P1 · ❌ fail

```
fn g(a: int):
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** ST-01 with `a`.
- **Basis:** the moment right after typing the header: spec §3.3.
- **Today:** missing a

### RB-02 · Empty block in the middle · P1 · ✅ pass

```
  if n:
    ‸
  0
---
  for i in xs:
    ‸
  0
---
  match d:
    case Approved{by}:
      ‸
    case _: 0
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-01 (the names around).
- **Basis:** a block is freshly opened at the moment of typing.

### RB-02b · Bindings in a freshly opened block · P1 · ❌ fail

```
  for i in xs:
    ‸
  0
---
  if r is Ok{value as y}:
    ‸
  0
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `i` / `y`.
- **Basis:** as RB-02.
- **Today:** #1 binding missing; #2 binding missing

### RB-03 · Trailing dot with code below · P1 · ✅ pass

```
  p.‸
  let y = 1
  y
---
  xs.‸
  return 1
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01/ME-08: the parser must not swallow the next line.
- **Not:** Scope.
- **Basis:** typing `x.` in the middle of a file is the common case.

### RB-04 · Unclosed literal with code below · P1 · ✅ pass

```
  Pair{first: 1, ‸
  return 1
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** LI-02.
- **Not:** Scope.
- **Basis:** as RB-03.

### RB-04b · Unclosed call with code below · P1 · ❌ fail

```
  plus(1, ‸
  return 1
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** CA-03.
- **Not:** Scope.
- **Basis:** as RB-03.
- **Today:** missing b:

### RB-05 · Errors elsewhere · P1 · ❌ fail

```
fn broken(:
  1

fn g(xs: Array<int>) -> int:
  xs.‸
  0
---
fn broken() -> int:
  let = 
  1
fn g(p: Pair) -> int:
  p.‸
  0
```
- **Where / trigger:** top level; typing `.`
- **Offer:** The members, as in a clean file.
- **Basis:** a broken declaration must not turn completion off.
- **Today:** #1 nothing offered

### RB-06 · A type error in the same function · P1 · ✅ pass

```
  const bad: string = 1
  p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01.
- **Basis:** as RB-05.

### RB-07 · Empty file · P2 · ❌ fail

```
‸
```
- **Where / trigger:** empty file; invoked, or typing on
- **Offer:** TL-01's declaration keywords.
- **Not:** TL-01's.
- **Basis:** TL-01.
- **Today:** unexpected let; unexpected while

### RB-08 · Non-BMP characters before the cursor · P2 · ✅ pass

```
  const s = "😀"; p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01: the cursor's column counts UTF-16 units, as LSP defines.
- **Basis:** LSP Position: UTF-16 code units.

### RB-09 · CRLF line endings · P2 · ✅ pass

```
  p.‸
  0
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** ME-01 on a CRLF document.
- **Basis:** LSP Position over `\r\n`.

### RB-10 · Position past the end · P3 · ✅ pass

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A position beyond the line or the document gives an empty list, never an error.
- **Not:** Errors.
- **Basis:** LSP position clamping.

### RB-11 · Unknown document · P3 · ✅ pass

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A document the server was never sent gives an empty list, never an error.
- **Not:** Errors.
- **Basis:** LSP.

### RB-12 · The latest text answers · P1 · ✅ pass

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** After a burst of edits the list answers the last text sent (documents are replaced whole on every change).
- **Not:** A stale snapshot.
- **Basis:** LSP full sync.

### RB-13 · Unsaved (untitled) document · P2 · ❌ fail

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Completion works in a document with no file (`untitled:` URI).
- **Not:** Nothing offered.
- **Basis:** the client selects `untitled` documents (extension.ts documentSelector).
- **Today:** offered []

## VC: VS Code client

`.vscode/extensions/ista` and its settings.

### VC-01 · Word-based suggestions off · P1 · ❌ fail

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `[ista]` sets `editor.wordBasedSuggestions` to `off`, so a position with an empty list (NO group) shows nothing instead of the file's words.
- **Not:** Words of the file offered where the server offers none.
- **Basis:** VS Code: word-based suggestions fill in when the language server gives no items.
- **Today:** [ista] editor.wordBasedSuggestions is undefined

### VC-02 · Suggestions on typing · P2 · ❌ fail

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `[ista]` states `editor.quickSuggestions` (on for code, off in strings and comments) so that no user setting makes lists open inside strings or comments.
- **Basis:** VS Code settings.
- **Today:** [ista] editor.quickSuggestions unset

### VC-03 · Word pattern · P3 · ❌ fail

- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The language configuration declares `wordPattern` as `[A-Za-z_][A-Za-z0-9_]*`, so the client filters and replaces whole identifiers.
- **Basis:** VS Code `wordPattern`.
- **Today:** no wordPattern

