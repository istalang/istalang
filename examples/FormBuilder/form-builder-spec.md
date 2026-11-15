---
description: specification and Istalang implementation design of the schema-based form builder — schema, code generator, generic runtime, and acceptance scenarios
owner: tech-lead
status: active
applies_to: examples/FormBuilder
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [form-builder, specification, istalang]
---

# Form Builder: Specification and Istalang Implementation

This document specifies a form builder whose forms are data, edited by people in a drag-and-drop editor and by agents, and run as Istalang code. It covers the problem, the form schema, how a form becomes Istalang, the runtime that runs every form, and the language features the design relies on. It is written for the agent implementing Istalang, and doubles as an end-to-end test of the language's expressiveness: the two example forms exercise every part of the design, and §9 gives acceptance scenarios.

**Status of the companion code.** The TypeScript files (`form-spec.ts`, `form-spec.test.ts`, `generate.ts`) compile under `tsc --strict`, the spec tests pass, and the generator produces the two `.gen.ista` files from the two `.form.json` files. The Istalang files (`computed.ista`, `forms/`, `*.gen.ista`, `order.ista`, `supplier.ista`) are checked against the Istalang compiler; see `ista-alignment.md` for the alignment report.

| File | What it is |
| --- | --- |
| `form-builder-spec.md` | This document |
| `ista-alignment.md` | Archived: alignment of the first runtime with the Istalang specification and compiler |
| `form-spec.ts` | The form schema as TypeScript types (also in §4.8) |
| `form-spec.test.ts` | Type tests: both example forms, and 14 forms that must be rejected |
| `generate.ts` | The generator: form JSON → Istalang module |
| `computed.ista` | Derived values with dynamic dependencies, which the runtime is built on |
| `forms/` | The runtime every form uses: its model, checks, views, tree, and the form with its two live functions |
| `order.test.ista`, `supplier.test.ista`, `forms/form.test.ista` | The runtime's scenarios, on both example forms and on small forms of their own |
| `order-demo.ista`, `supplier-demo.ista` and their `.host.mjs` | Both example forms run through their live functions, with scripted hosts |
| `order.form.json`, `order.gen.ista`, `order.ista` | A small example: schema, generated module, hand-written logic (also in Appendix A) |
| `supplier.form.json`, `supplier.gen.ista`, `supplier.ista` | A full example using every feature of the schema |

---

## 1. The problem

A business process needs forms: an order, a supplier's onboarding, an approval request. Three kinds of author create and change them:

- people, in a **drag-and-drop editor**, who never write code;
- **agents**, who edit the same definitions;
- developers, who write the occasional piece of real logic.

Forms are therefore **data**: a JSON document per form, versioned and stored on its own, independent of any submission. A submission is the data one filled-in form produces.

The forms must be flexible:

- **Layout is free of data shape.** Sections, rows, wizards and tables arrange the form however the designer likes; where a value is stored is a separate choice (its path).
- **Data can be nested, repeated and conditional:** objects, arrays of rows, variants (one of several cases), fields shown only under a condition.
- **Anything can be computed:** labels, visibility, bounds, defaults, options, even widget settings.
- **Values can come from elsewhere:** sources (other systems, slow or fast), and steps that take days, such as a manager's approval.
- **Forms compose:** a form can mount another, from a shared catalog or defined locally, and even one chosen at run time.
- **Forms are localized.**

And they must be dependable:

- A workflow consuming a form needs its **result typed**, checked at compile time.
- Validation must be **identical in the browser and on the server**; the server's result is authoritative.
- A form whose submission waits days for an approval must **survive restarts**.

**Istalang** is the language the workflows are written in. It is statically typed, runs anywhere (its compiler and interpreter are TypeScript), and its instances are durable: every `await` is a save point, and an instance can wait for days. So the design is: **forms are JSON; each form becomes a small Istalang module; one generic Istalang runtime runs every form.**

## 2. The solution in brief

```
 editor / agent ──► order.form.json ──► generate.ts ──► order.gen.ista ─┐
                                                                        ├─► compiled ─► run
                     order.ista (hand-written logic, optional) ─────────┤
                     forms/ (the runtime, written once) ────────────────┘
```

**The JSON is the source of truth**, typed in TypeScript (`form-spec.ts`) for editors and agents. The types catch structural mistakes. Expressions inside the JSON are Istalang, and the Istalang compiler checks them.

**The generator never parses an expression.** It pastes each one into a closure. Its only text handling is splitting paths on `.`, finding the `${…}` spans of a message template, and finding whether an expression names a single-field row's variable.

**A form's generated module is declarative.** For the form, and for each local def, it holds:

- a **model**: a struct with one node per path, which holds the values;
- the model's **factory**;
- what its **expressions see**: structs whose getters read the model, so every read is tracked;
- a **view**: a static tree of view nodes, with every expression a closure over its scope.

There is no generated control flow: no rendering, validation or event code.

**The runtime (`forms/`) is generic.** It holds the model, the view as computeds over it (`computed.ista`), validation, event routing, reading the result, and the two live functions that drive a form.

**Types are computed, not generated.** Every model node declares two associated types:

- `Data`: what a submission holds;
- `Seen`: what expressions see, where anything unanswered or hidden is `none`.

They compose through the tree with mapped types, so `OrderData = Group<OrderModel>.Data` is the form's result type, written by nobody.

**A form has two live entry points.** Everything else is simple code, usable alike in the browser and on the server:
1. **The browser's**, `orderForm(params, user)`, serves the form: it shows its tree to the frontend, applies each event, and shows the tree again, until a valid submit, whose whole value it gives its host to submit.
2. **The backend's**, `validateOrder(params, user, value)`, validates a whole value and gives `OrderData` or the errors by node key.

## 3. Architecture and lifecycle

**Editing.** The editor and agents edit the JSON, and `form-spec.ts` validates it as they go. Editing labels, layout, widgets, literals or options changes only the JSON. Changing an expression or a path changes the generated module, which must be recompiled.

**Compiling.** The generator emits the module. The Istalang compiler then compiles it together with `forms` and the form's `imports`. A running interpreter cannot load new modules, so every change produces a new program version.

**Previewing.** The editor's preview restarts the form's browser function on each new version and replays the events recorded so far, so the preview keeps what the user has typed.

**Running.** The form runs in the browser, in the TypeScript interpreter, inside a Web Worker. The host starts the form's browser function once, as a live run, which holds the form for the whole session: the host starts a function with JSON arguments and disposes what it holds when it returns, so the form lives as long as the run. The run waits for each event on a host extern, `nextEvent`, and gives each tree to another, `show` (`forms/form.ista`).
- **Rendering:** the frontend renders each tree with React, keyed by node key. The runtime gives a host the same frozen object for a value it gave before, kept unchanged (spec §9, "Stable references"), and the computed views keep an unchanged node's object, so a frontend drawing in the interpreter's JavaScript realm gets it again and React's memoization works without a diffing pass. No identity crosses a message channel.
- **Drafts:** a partly filled form may be saved at any time; drafts are not validated.

**Submitting.** On a valid submit the browser function gives the form's whole value to its host and ends: what the backend validates, local values included, which the data leaves out. The host sends it to the server, whose backend function validates the whole value against the same form version, as submitted, in one view: the server's result is authoritative, and no events are replayed.

**Consuming.** A workflow gets a submission's typed `Data` from the backend's validation, which it calls through `delegate`.

**Versioning.** A form's version is computed on publish by comparing the output types:
- **patch:** the output type is unchanged;
- **minor:** it still accepts every old value;
- **major:** anything else. A change to a condition expression, or to a stored computed expression, counts as major. Defaults never bump the version, because a default's value is stored in the submission.

A running instance stays on the version it started with.

## 4. The form schema

The schema is the TypeScript in §4.8, which is `form-spec.ts`. This section explains its parts. The types are best-effort: they catch structural mistakes, such as a widget that can't render a field type, a missing label, a wrong prop type, or an option list on a widget that takes none. Everything about expressions and data types is the Istalang compiler's job.

### 4.1 Expressions, props, templates

An **expression** (`Expr`) is an Istalang expression, pasted into the generated code. These names are in scope:

| Name | Meaning |
| --- | --- |
| `data` | The form's values by path. Each is `none` while unanswered or hidden. |
| `ctx` | `ctx.params` (the form's params), `ctx.user` (the person filling it in), and any variable the node's widget provides (`ctx.search` for an autocomplete). |
| Repeat and variant variables | The `as` names of enclosing repeats and variants (`item`, `pay`). |
| `row` | Inside options' `value` and `label`: the row being mapped. |
| Imported modules | The `imports` aliases: hand-written logic and sources. |

Everything an expression calls returns at once; see §4.3.

A **prop** (`Prop<T>`) is anything that may be computed: a JSON literal, or `{ "expr": "…" }`. The generator emits a closure giving either: a literal as an Istalang literal, an expression pasted as it is. Props include:
- labels, help, and every widget ui prop;
- `ui.parent` props;
- defaults;
- constraint bounds (`max: { expr: "data.budget" }`) and `required`, so a requirement can be conditional.

Every expression's type follows from where it sits (a label is a `String`, a `when` a `Bool`, a default the field's type), so the generator never infers a type.

A **template** (`Template`) is message text with `${…}` Istalang interpolations, such as `We don't ship to ${data.country}`. It becomes an Istalang template literal. Its literal text is the localization key. `\${` is a literal `${`.

### 4.2 Paths and names

A path is `data` or a bound variable, followed by field names joined by `.`: `data.company.name`, `item.qty`.
- **Repeats:** a repeat's path names the array; the rows are reached through its variable.
- **Single-value items:** an item that is a single value (a multiselect's choice) has the bare variable as its path.
- **No indexes:** there is no `[]` and no index anywhere.

Each segment becomes an Istalang field name, so it is a camelCase identifier.

Several nodes may write one path; they share one value (§6.1).

### 4.3 Sources

Sources are simple extern functions the host implements: the browser's by asking the backend, the backend's by its own means, tests and examples by mocks. An expression calls one as it calls any function, and it returns at once, so nothing in a form waits: there is no loading state, and a rule runs whenever its node is shown, as every other check does.

### 4.4 Field types, presence, constraints, rules

**Field types:** `text`, `number`, `integer`, `boolean`, `date`, `datetime`, `file`.

**Presence and `required` are different.**
- **Every stored field must be answered** unless it has a default (or is computed).
- **A value is always in the output** unless a `when` can hide it; then its key is optional.
- **`required` means non-empty:** text not `""`, an array at least one item. It exists only on text and arrays.
- **Booleans:** whether "unanswered" can be shown (a three-state toggle) is the widget's concern.

**Constraints per type:**
- text: `minLength`, `maxLength`, `pattern`, `format` (`email`, `uri`, `uuid`);
- numbers: `min`, `max`, `multipleOf`;
- dates: `min`, `max`;
- files: `accept`, `maxBytes`;
- arrays: `minItems`, `maxItems`, `required`.

Bounds are props, so they can come from data.

**Rules** are custom checks: `{ check, message }`, where `check` is a boolean expression and `message` a template. A rule may span several fields; its error attaches to the node carrying it. A layout with only rules is a validation-only node (the `errors` widget shows its errors).

**Validation is the union.** Every writer's constraints and rules apply, plus those of the path's `types` entry.

**What isn't validated:**
- **Hidden nodes** are skipped entirely: not validated, not stored, not seen by expressions.
- **Values with `store: "none"`** are still validated, though not stored.
- **Computed values** are checked if they have constraints.

### 4.5 Options

A field takes options when its widget requires them (select, radio, segmented, autocomplete, choice).

**Static options:** `{ items: [{ value, label }] }`. The values must match the field type. A field whose writers all use static options gets a literal-union type, such as `Field<"small" | "medium" | "large">`.

**Options from rows:** `{ from, value, label, resolve, rowType? }`.
- `from` yields rows, and may call a source.
- `value` and `label` map each row, with `row` in scope.
- `resolve` checks the submitted value. It is always required: rows may come from a search, or change after the user picked, so `resolve` is the one membership check.
- `store: "snapshot"` stores the picked row itself instead of its value. Its type is `rowType`, an Istalang type name.
- With a widget that provides `search`, `from` reads the typed text as `ctx.search`.

### 4.6 Widgets, content, labels

**The registry.** Widgets come from a registry the platform declares and extends over time. Each widget is one of four kinds:
- **field widgets** render a field type;
- **repeat widgets** render an array;
- **variant widgets** render a variant;
- **layout widgets** arrange children and hold no data.

The generator turns the registry into Istalang enums (`FieldWidget`, `RepeatWidget`, `VariantWidget`, `LayoutWidget`), one variant per widget, with its ui props as the variant's fields.

**Content policies.** A repeat or layout widget declares what it holds: `none`, `any` node, or only nodes using named widgets of each kind.
- A `wizard` holds only `step`s.
- A `table`'s item is a `tablerow`, whose cells are compact field widgets or a `multiselect`.
- `step`, `tablerow`, `choice` and `raw` are **restricted**: valid only where a parent names them.

**Arrays and composites.**
- **Arrays of values** are repeats. A `multiselect` or `checkboxes` is a repeat whose item is one `choice` field, which the repeat draws itself.
- **Composite controls** use the same idea. A layout widget with `control: true` (`money`) draws its `raw`/`choice` children as one input, and takes a label.

**`ui` and `ui.parent`.**
- `ui` holds the node's own widget's props, each a prop.
- `ui.parent` holds what the parent widget reads about this node: an `hstack`'s `grow`, a `tablerow`'s column `width`, a `section`'s `span`. It is typed by the parent's `childUi`, and is rejected where the parent reads none.
- `parent` is a reserved ui name.

**Labels.** A label names a node: it is the accessible name, the name in error messages, and the title in the output schema.
- Fields must have one; repeats, variants and refs should.
- Layouts have none, except control layouts. A section's title is a ui prop.

Who draws a label:
1. a widget that `ownsLabel` (a checkbox) draws its own;
2. otherwise the parent layout draws it, as its `ui.labels` says (`top`, `start`, `hidden`), and a `tablerow` draws its cells' labels as column headers;
3. a node with no layout parent draws no visible label; wrap it in `labeled` to show one.

A variant draws its case labels in its case picker, if it has one.

### 4.7 Nodes and the document

**Common to all nodes:**
- `when`: a node hidden by its `when` doesn't exist (§4.4).

**field.** `type`, `widget`, `label`, `help?`, `path?`, `store?`, `default?`, `computed?`, `constraints?`, `options?`, `ui?`.
- A field without a path shows a computed value only. It is never stored, and expressions can't read it; use `store: "none"` for a value that is addressable but not stored.
- `store` is `value` (the default), `none`, or `snapshot`.
- `default` is the initial value, re-evaluated until the user edits it. `computed` is always derived and read-only. The two are exclusive.

**repeat.** `path`, `as`, `widget`, `label?`, `item` (one node), `constraints?`, `default?` / `computed?` (rows), `editableCount?`, `rowKey?`, `recomputeUntil?`.
- **`editableCount: false`:** the default supplies the rows (one per product to rate), and the user fills them in but can't add or remove any.
- **`rowKey`** identifies rows that come from data, so filled-in cells follow their row when the data changes. A row whose key disappears is dropped with its data, and duplicate keys are a validation error. Rows the user adds are keyed by the instance.
- **`recomputeUntil`** decides when a computed default stops re-running: on the first added or removed row (`rows-edited`), or on any edit inside (`any-edit`).

**variant.** `path`, `as`, `tag`, `widget`, `label?`, `cases` (each `{ label, body }`, one body node), `default?` (a case id), `computed?` (a computed tag).
- The tag is a field. Anyone may write it: the variant's picker (`inline`), or any field elsewhere writing `<path>.<tag>`.
- A case's fields are reached through the variable inside that case's body.

**ref.** Mounts a form as a sealed black box: nothing inside it can be overridden, ui included.
- **Static ref:** `form` is a catalog form (`catalog:contact-card@^1`) or a local def (`#address`), with `params`. The mounted form draws itself, so a static ref takes no `label`.
- **Dynamic ref:** `schema` is an expression yielding a compiled form chosen at run time, shown under the ref's `label`. Its data is JSON that the host's run of it validates and sends back as a `Set` to the mount's key; this form keeps it as it is.
- **Recursion:** a def may mount itself where recursion can end, such as under a repeat.

**layout.** `widget`, `children` (as the widget's content policy allows), `ui`, `label` (control layouts only), and `constraints.rules`.

**The document:**
- `id`, `version` (semver);
- `params`: the form's inputs, declared types (§4.8 `TypeDecl`, including `{ ista: "crm.User" }` for any Istalang type);
- `types`: assigns a path's type, to which every writer must conform; undeclared, a path's type is the intersection of what its writers produce;
- `imports`: modules the expressions use, by alias;
- `defs`: local forms;
- `localization`: translations keyed by the original text (written once), then by two-letter language. In a translation, `$0…$n` stand for the original's `${…}` values in order: `"Only ${.stock} left"` → `"Nur noch $0 übrig"`.

### 4.8 The schema types

The complete schema follows at the end of this document as Appendix B (it is `form-spec.ts`, verbatim). `form-spec.test.ts` checks both example forms against it, plus 14 forms it must reject.

## 5. From JSON to Istalang

### 5.1 The generated module

For the form and for each local def `d`, the generator emits:

| Generated | Example (order form) |
| --- | --- |
| Params and ctx structs | `struct OrderParams: region: String`, `struct OrderCtx { params: OrderParams, user: User }`; a def's ctx gives its params through a getter reading what its mount says, `fn get params(self: AddressCtx) -> AddressParams` |
| The model struct: one node per top-level path | `struct OrderModel { country: Field<String>, city: Hidden<Field<String>>, items: List<OrderItemsRow>, … }` |
| Aliases for row and case types | `type OrderItemsRow = Group<{ sku: Field<String>, qty: Field<Int> }>` |
| The factory, on a graph | `fn orderModel(graph: Graph) -> Group<OrderModel>`; a row's nodes are made holding the row's data |
| What expressions see, per scope | `struct OrderSeen: m: OrderModel` with `fn get country(self: OrderSeen) -> String?`; one per row, case and nested group |
| The view, built at a place | `fn orderView(at: Place, m: OrderModel, ctx: OrderCtx) -> View`; for a def, `fn addressView(at, m, ctx, k: String)`, with `k` prefixing its keys |
| For the form only, its opening and entry points | `fn openOrder(params, user) -> Form<OrderModel>`; `live async fn orderForm(params, user)`, giving the value to submit, and `live fn validateOrder(params, user, value)` |

It also emits the `imports` (of the runtime, only what it uses), an import per catalog form (`import * as contactCard from './catalog/contact-card@^1'`; a catalog form is a module in the shape a local def is generated in, exporting `Model`, `Params`, `Ctx`, `model()` and `view()`), and the localization table. The Istalang formatter lays the module out, so `node generate.ts order.form.json > order.gen.ista` reproduces the module checked in.

### 5.2 Deriving the model

Pass 1 walks the tree and builds the model from the paths. It first creates the structural nodes (repeats, variants, mounts), so a field writing a variant's tag finds the variant, then the fields.

| Schema | Model node |
| --- | --- |
| A field's path | `Field<T>`, `T` from the field type: `String`, `Float`, `Int`, `Bool`, `Date`, `DateTime`, `FileId` |
| Static options on every writer | `Field<"a" \| "b">`, the intersection of the writers' values |
| `store: "snapshot"` | `Field<rowType>` |
| A `types` entry | its declared type |
| Intermediate path segments | `Group<{ … }>` |
| A repeat | `List<Row>`, where `Row` is `Group<{ … }>`, a single `Field<T>` (an item whose path is the variable), or a mounted form |
| A variant | `Variant<Cases>`, `Cases` a struct of case-name → `Group<{ … }>`; its tag is `Field<"card" \| "wire">` |
| A static ref | the def's or catalog form's `Group<Model>` |
| A dynamic ref | `Dynamic` |
| `store: "none"` | `Local<N>`: seen by expressions, validated, not output |
| Every writer of a path can be hidden by a `when` (its own or an ancestor's, up to the nearest repeat or variant) | wrapped in `Hidden<N>`, whose `Data` is optional |

The model's fields follow the order in which the schema first mentions each path.

### 5.3 Generating the view

Pass 2 walks the tree again and emits a view node per schema node, each built at its parent's place: `FieldView{…}.build(at)`, a layout's children each `fn(at): …`.

| Schema | View node |
| --- | --- |
| layout | `LayoutView` |
| field | `FieldView`, holding the model's `Field` (none when pathless) and, if hideable, its `Hidden`'s `shown` |
| repeat | `RepeatView`, whose `item` builds a row's view from the row's node and key |
| variant | `VariantView` with a `CaseView` per case |
| static ref | the mounted form's view, built at the mount's place with that form's own scope |
| dynamic ref | `DynamicView` |

Its rules:

- **Closures.** Every expression is pasted into a closure over its scope, `fn(): <expr>`, and a literal prop becomes `fn(): <literal>`. The checker infers each closure's type from where it sits, so no generated code names a view's type.
- **Widgets.** The widget and its ui props become one closure: `fn(): FieldWidget.Select(none)`.
- **Scopes.** `data` is a struct whose getters read the model (`OrderSeen`), and so is a nested group. A repeat's row binds its variable to its row's struct (`const item = OrderItemsRowSeen{m: r1}`), and a variant's case to its case's (`const p = OrderPaymentCardSeen{m: m.payment.cases.card}`). A row of a single field binds its variable inside each closure that names it, read off the row as the closure runs (`const region = r2.seen()`).
- **Mounts.** A mount calls its form's view at its own place, with that form's scope: `addressView(at.within(when, hide), m.company.fields.address.node.fields, AddressCtx{user: ctx.user, paramsFrom: fn(): AddressParams{country: (…)}}, "n18")`. The mounted form's expressions read its params when they run, and so whatever the mount's expressions read. A def's factory takes the data it is made from, as a row does.
- **Keys.** Nodes are numbered in tree order: `n1`, `n2`… A key inside a repeat row adds the row's key (`n6@r1`; nested rows `n9@r1@r2`), and inside a mounted def its mount's key (`n18/n2`). Keys are stable within a version.
- **Checks.**
  - Every stored field without a default or computed value gets `checks.answered()`, unless it is `required: true`, which says that too.
  - Each constraint becomes a helper call taking closures (`checks.maxLength(fn(): 120)`), including those from the path's `types` entry.
  - A rule becomes `checks.rule(check, message)`.
  - A variant whose own picker writes its tag, with no default, computed tag or field writing it, gets `checks.answered()`.
- **Options.**
  - Static options become `Options.Items`.
  - Options from rows become `Options.Rows`, where `from` is `[for row in <from>: Choice{value: <value>, label: <label>}]`.
  - With a search widget they become `Options.Search`, whose `from` takes the typed text and widens `ctx` with it: `const ctx = struct{search, params: ctx.params, user: ctx.user}`.
- **Templates.** A message template becomes a template literal with each `${…}` wrapped in `checks.text(…)`. If the form translates it, it becomes ``checks.t(translations, ctx.user.lang, "<original>", `<rendered>`, [checks.text(arg0), …])``. A string literal that has a translation (a label, a section title) becomes such a call too.

## 6. The runtime

`forms/` is the runtime, on `computed.ista`; `docs/work/computed/design.md` gives its design. This section summarizes it.

### 6.1 The model

Every model node implements `FormNode`, with associated types `Data` and `Seen` and methods `seen()`, `read() -> Result<Data>` and `load(Seen)`. Its values are pulled: each is a computed of the form's graph, read when an expression or the view reads it, and nothing writes while a view is read. Only events set sources, between views; validation loads a whole value before its one view.

| Node | Data | Seen | Notes |
| --- | --- | --- | --- |
| `Field<T>` | `T` | `T?` | What the user entered (a source), and its value: entered, else a default until edited, or a computed value |
| `Group<S>` | `{ [F in keyof S]: S[F].Data }` (via `type match`) | the same, with `Seen` | |
| `List<R>` | `Array<R.Data>` | `Array<R.Seen>` | The rows the user added or removed, else rows from data: a default, or computed rows, kept by `rowKey` |
| `Variant<C>` | `{ tag: keyof C, value: { [K in keyof C]: C[K].Data? } }` | `{ tag: (keyof C)?, value: { [K in keyof C]: C[K].Seen? } }` | The tag is a `Field<keyof C>` |
| `Hidden<N>` | `N.Data?` | `N.Seen?` | Shown while any view writing it is visible |
| `Local<N>` | `None` | `N.Seen` | Kept out of the output |
| `Dynamic` | `String` (JSON) | `String?` | A mounted dynamic form's data, as the host sends it; unanswered until then |

**Nodes are handles.** The model and every view writing a path hold the same sources and computeds. That is all multiple writers and outside tag writers need: two `FieldView`s holding one `Field`.

**Constraints and `when`s live in the view, not the model.** The model's types determine `Seen`, and expressions read `Seen`, so an expression stored in the model would make the model's type depend on itself. What a view says of a node, a default, a computed value, rows from data, or that it writes a hidden node, is bound into the node once, when the view is built.

### 6.2 The view

The generated code describes each node with a struct, `FieldView`, `RepeatView`, `VariantView` (with `CaseView`s), `LayoutView` or `DynamicView`, and builds it at a `Place`: the form's graph and submit flag, and whether the parent is visible. A built node is a `View`: a computed of its drawn nodes and validity, and how it routes an event to a key it shows.
- **Scopes are bound when built.** Every expression is a closure over the scope's variables: `data`, `ctx`, and the variables of enclosing repeats and variants. A scope variable is a generated struct whose getters read the model, so each read is tracked. A repeat's row, a variant's case and a mounted form are built with their own scope by generated code.
- **Visibility is a computed per place:** a node's `when` and every ancestor's. A hidden node draws nothing and its expressions are never brought up to date.
- **Each node evaluates at most once per view,** and only when something it read changed: an edit re-draws the nodes reading it, and the others keep their drawings, the same objects.
- **Errors** show once a node is touched or the form submitted; validity counts them all.

**Repeat rows.** A row is made holding the data it comes from, and its list hands it to the repeat at once, which builds its view: a row's defaults, computed values and hidden nodes are bound before anything can read it.
- **Default rows:** made from data once, or followed while `recomputeUntil` is `RowsEdited`, until the user adds or removes a row. A list's default rows are the data it was made with, as a row's nested list is.
- **Computed rows** follow their data, read-only.
- **Keys:** with a `rowKey`, a row whose key stays keeps its node, and so its values; without one, a row is kept while its place and data stay.
- **A repeat's checks count its rows:** they see the rows' keys, so what a row holds, answered or not, neither hides nor fakes a `minItems`, `maxItems` or `required` error.
- **A variant's picker** reports an unanswered tag through `answered()` among the variant's checks, which take the tag, as a field's take its value.

### 6.3 The two live functions

`forms/form.ista` gives each form, opened on a graph of its own, the steps both drivers share: `apply(event)` sets sources between views, and `result()` reads the tree and gives the data when valid, else the errors by node key.
- **`serve`, the browser's:** shows the root's tree (`show`), awaits the next event (`nextEvent`), and applies it, until a submitted form is valid; then it gives the form's whole value, what the backend validates.
  - `Set(key, value)` routes to the field or variant shown under `key`, which parses the JSON value into its type; to a dynamic mount, it is the mounted form's data, kept as it is.
  - `Search(key, text)` stores the typed text, which the field's options read.
  - `AddRow` and `RemoveRow` change a list.
  - `Submit` marks the form submitted.
  - An event to a key not shown changes nothing.
- **`validate`, the backend's:** loads a whole value, marks the form submitted, and gives `result()`. A list's rows are made from the value as rows from data are, and keyed alike, so the backend's error keys are the browser's. Values for hidden nodes are dropped: hidden nodes don't exist.

### 6.4 What the frontend receives

A `Node` tree:
- `Layout`, `Field`, `Repeat` (with `Row`s), `Variant` and `Mount`;
- each node has its key, its widget enum value with evaluated ui props, `ParentUi`, label and errors;
- a field's value and options are JSON-encoded.

The frontend draws it with a generic recursive component and sends events by key. It knows nothing about any particular form.

## 7. Design decisions

| Decision | Why |
| --- | --- |
| JSON is the source; the generated module is never edited | Drag-and-drop and agents need data, not code |
| Expressions are pasted, never parsed | One language for logic, checked by its real compiler; the generator stays small |
| The model holds values; the view holds everything else | Multiple writers and tag writers fall out as shared handles, and the model's types stay free of cycles |
| `Data` and `Seen` are computed types | The form's result type is derived from its definition, never written or generated separately |
| Hidden nodes don't exist | Hidden values can't silently affect expressions, validation or output |
| Output shape is free (`{ tag, value }` for variants) | Istalang owns the data; no external JSON contract constrains it |
| Values and views are computeds, pulled | A node evaluates only when what it read changed, at most once per view; nothing writes during a view, so no redraw loop or pass limit exists |
| Simple code, two live entry points | One core serves the browser and validates on the server |
| The server validates the submitted value | No event log to replay; the server's result is authoritative |
| Sources return at once | Nothing waits: no loading states, no tasks |

## 8. Language features the design relies on

The design uses Istalang as the guide describes it: structs, enums, generics, traits with associated types, struct constraints, mapped struct types, field loops, `keyof`, literal unions, shared structs and live functions. It also relies on the following, which the guide doesn't show, each used by `forms/` or the generated code. Where a fallback exists, it is noted.

| # | Feature | Used for | Example | Fallback |
| --- | --- | --- | --- | --- |
| 1 | Mapped struct literal: build a value field by field | `Group.seen()`, `read()` | `{ for f, node in ...self.fields: [f]: node.seen() }` | None found: needed to stay generic |
| 2 | A mapped type indexed by the union of its keys yields a union | `Variant<C>.Data` | `{ [K in keyof C]: { case: K, value: … } }[keyof C]` | A struct `{ case: keyof C, value: { [K in keyof C]: …? } }` |
| 3 | Reading a struct field with a union-typed key value | `Variant.read()` | `self.cases[k]` where `k: keyof C` | A field loop with `if f == k` |
| 4 | Top-level type aliases, including generic ones | Row and case types | `type OrderItemsRow = Group<{ sku: Field<String>, qty: Field<Int> }>` | Associated types on a generated struct |
| 5 | Transient variables (proposal 13) | One view and one current reader shared by every computed | `transient let view: _View? = none` | None found |
| 6 | Getters (proposal 13) | Scope variables whose reads are tracked | `fn get country(self: OrderSeen) -> String?` | Read the model in each expression |
| 7 | Inert function types (proposal 14) | Closures kept in the graph, which may hold cycles | `eval: inert fn() -> T` | None found: the graph's cycles need it |
| 8 | Closures inferred inert | Every pasted expression is a closure over its scope | `fn(): data.country != none` | None needed if supported |
| 9 | Structural `==` on structs and computed types | An equal result keeps the old object and stops the update | `if cell->value == next: …` | Compare JSON strings |
| 10 | Parsing JSON into literal unions and computed types | Events set a tag; snapshots | `json.parse<"card" \| "wire">(v)` | Parse a string, then match |
| 11 | Recursive types through generic containers | A def mounting itself | `struct CategoryModel: children: List<Group<CategoryModel>>` | None needed if supported |
| 12 | Struct constraints satisfied by nested anonymous structs of generic nodes | `Group<{ a: Field<String>, b: Hidden<Field<Int>> }>` | `S is struct { [_] is FormNode }` | None found |
| 13 | Empty struct declarations | Params of a def with none | `struct CategoryParams {}` | A `Unit` field |
| 14 | Closure parameter types inferred from the expected type | Every generated closure | `item: fn(r1, row1, at): …` | Spell each one out |

**The host must also provide:**
- the frontend's events and its trees, through the externs `nextEvent` and `show`;
- the sources, as simple externs;
- for dynamic refs, a way to run a separately compiled form and mount its view. A running interpreter can't load modules, so the host runs the mounted form as its own instance and sends its data back as a `Set` to the mount's key, which the parent keeps in a `Dynamic`.

## 9. Acceptance scenarios

These exercise the order form (Appendix A) end to end. Run them in the interpreter with the sources mocked as given, applying events to the form, and compare the trees and the data. `order.test.ista` runs them on the simple core; `order-demo.ista` runs S5 and S8 through the two live functions, as their hosts start them. The supplier form's features run the same way: `supplier.test.ista` on the simple core, and `supplier-demo.ista` through both live functions, a scripted session filling every step.

**Mocked sources** (`geo`, `approvals`):
- `geo.countries("eu")` returns `[{id: "de", name: "Germany"}, {id: "kp", name: "North Korea"}]`.
- `geo.cities("de")` returns `[{id: "ber", name: "Berlin"}]`.
- `approvals.ask(…)` returns what the scenario says, `true` unless it says otherwise.

Params: `{region: "eu"}`. User: `{id: "u1", name: "Ana", lang: "de", role: "buyer", today: "2026-11-05"}`.

**S1. The first view.** Start the form.
- **Expected tree:** the section `n1` with:
  - `n2` Country, a select with two options;
  - `n4`, an empty table that can add rows;
  - `n8` Total quantity = 0, read-only;
  - `n9` Payment, an inline picker with no active case.
- **Not present:** `n3` City (no country yet) and `n12` (total ≤ 100).
- **Errors:** none shown (nothing touched, not submitted).

**S2. Dependent options.** `Set{key: "n2", value: "\"de\""}`: `n3` appears, a select with Berlin. Before it, `geo.cities` was never called.

**S3. A localized rule.** `Set{key: "n2", value: "\"kp\""}`: `n2` shows `Wir liefern nicht nach kp`, the German translation with `$0` filled with the argument's text.

**S4. Rows and conditions.**
1. `AddRow{key: "n4"}` twice: rows `r1` and `r2` appear.
2. `Set{key: "n6@r1", value: "\"A1\""}`, `Set{key: "n7@r1", value: "60"}`, and the same for `r2` with `"B2"` and `50`: `n8` = 110, and `n12` appears with `rows: 3`.
3. `RemoveRow{key: "n4", row: "r2"}`: `n12` disappears; `n8` = 60.

**S5. Submit and result.** From S4 after step 3, with country `de`:
1. `Set n3 "ber"`, `Set n9 "card"`, `Set n10 "1234"`, `Submit`: the form returns
   ```
   OrderData{country: "de", city: "ber", items: [{sku: "A1", qty: 60}],
             payment: {tag: "card", value: {card: {last4: "1234"}, wire: none}}, note: none}
   ```
2. Typing: the value has type `Group<OrderModel>.Data`, and assigning it to a variable annotated with the expected shape compiles.

**S6. Approval blocks submission.** As S5, but with quantities totalling 600, and the note filled. With `approvals.ask` giving `false`, `Submit` shows "The order was not approved" on `n1`, and the form doesn't return; with `true`, it returns.

**S7. Validation messages.**
1. `Submit` on an empty form: every stored field shows "Required", and `n4` shows its minItems error.
2. `Set n10 "12a4"`: `n10` shows the pattern error.

**S8. Server validation.** The backend's function, given S5's data as JSON, gives the same `OrderData`. Given a value whose note is filled while the total is at most 100, it gives the data without the note. Given an empty value, it gives the errors by node key: `n2` "Required" and `n4` its minItems error.

The supplier form (`supplier.form.json`) is the full test. It compiles only if every feature in §4 and §8 works. Its coverage:

| Feature | Where in the supplier form |
| --- | --- |
| Wizard, steps, markdown with computed text | Root; Company step's welcome text |
| `section` (title, description, collapsible), `hstack` with `ui.parent.grow`, `labeled` with `labels` | Company section; name and VAT ID; the address def |
| Every field type | text, number (capital), integer (employees), boolean (agree, primary), date (founded), datetime (express delivery), file (logo) |
| Every constraint | minLength/maxLength/pattern/format, min/max/multipleOf, date bounds from `ctx`, accept/maxBytes, minItems/maxItems/required on repeats |
| Computed bounds and conditional `required` | `employees.max`, `contacts.maxItems`, `notes.required` |
| Rules: on a field, cross-field, with a localized template, an approval | `confirmEmail`, `employees`, the Review step's `errors` node |
| `store: "none"`, `store: "snapshot"` with `rowType`, pathless computed, stored computed | `confirmEmail`; `manager`, `extraForm`; catalog value; `score` |
| Literal and expression defaults; a default from a source | description, size, terms; `creditLimit` |
| Static options with a computed label; options from sources; resolve | size; countries, cities, regions |
| Autocomplete providing `ctx.search` | account manager |
| `when` on fields, refs, repeats | capital; address; city |
| Repeat with `editableCount: false`, `rowKey`, `recomputeUntil`, default rows from params | prices table |
| `tablerow` with `ui.parent.width`, a multiselect inside a table row | prices table |
| `list` with ui props and a catalog ref per row; `section` with `ui.parent.span` | contacts |
| `checkboxes` of static choices; `cards` of a recursive local def | certifications; categories |
| Computed rows (read-only list) | order history |
| Variant `panel` whose tag is written by an outside `segmented` field | payment |
| A `money` control layout with `raw` and `choice` children | wire transfer deposit |
| Variant `inline` with a default case | delivery |
| Static refs: local def with params; recursive local def; catalog form | address; category; contact card |
| Dynamic ref | the additional questionnaire |
| `types` block constraint | `data.company.vatId` pattern |
| `params` of every TypeDecl kind | region, tier (literal), products (array of objects), owner (Istalang type) |
| Localization of labels, ui props and templates | "Company"; employees rule |
| Label as an expression | notes |
| Divider, errors widget | Review step |

## 10. Open points

- **Dynamic refs:** the host protocol for running a mounted form as its own instance and embedding its view tree needs specifying; its data comes back as a `Set` to the mount's key.
- **Recursion bounds:** recursion through refs is assumed to end because repeats start empty; the generator does not yet reject unbounded recursion.

---

## Appendix A. The small example: the order form

### A.1 `order.form.json`

```json
{
  "id": "order",
  "version": "1.4.0",
  "imports": {
    "geo": "./geo",
    "approvals": "./approvals",
    "logic": "./order"
  },
  "params": {
    "region": "text"
  },
  "localization": {
    "We don't ship to ${data.country}": {
      "de": "Wir liefern nicht nach $0"
    }
  },
  "root": {
    "node": "layout",
    "widget": "section",
    "ui": {
      "title": "Order"
    },
    "constraints": {
      "rules": [
        {
          "check": "logic.totalQty(data.items) <= 500 or approvals.ask(ctx.user.id, logic.totalQty(data.items))",
          "message": "The order was not approved"
        }
      ]
    },
    "children": [
      {
        "node": "field",
        "path": "data.country",
        "type": "text",
        "widget": "select",
        "label": "Country",
        "options": {
          "from": "geo.countries(ctx.params.region)",
          "value": "row.id",
          "label": "row.name",
          "resolve": "geo.countries(ctx.params.region).some(fn c: c.id == data.country)"
        },
        "constraints": {
          "rules": [
            {
              "check": "not logic.isBlocked(data.country)",
              "message": "We don't ship to ${data.country}"
            }
          ]
        }
      },
      {
        "node": "field",
        "path": "data.city",
        "type": "text",
        "widget": "select",
        "label": "City",
        "when": "data.country != none",
        "options": {
          "from": "geo.cities(data.country ?? \"\")",
          "value": "row.id",
          "label": "row.name",
          "resolve": "geo.cities(data.country ?? \"\").some(fn c: c.id == data.city)"
        }
      },
      {
        "node": "repeat",
        "path": "data.items",
        "as": "item",
        "widget": "table",
        "label": "Items",
        "constraints": {
          "minItems": 1
        },
        "item": {
          "node": "layout",
          "widget": "tablerow",
          "children": [
            {
              "node": "field",
              "path": "item.sku",
              "type": "text",
              "widget": "input",
              "label": "SKU",
              "constraints": {
                "required": true
              }
            },
            {
              "node": "field",
              "path": "item.qty",
              "type": "integer",
              "widget": "input",
              "label": "Qty",
              "constraints": {
                "min": 1
              },
              "ui": {
                "parent": {
                  "width": 80
                }
              }
            }
          ]
        }
      },
      {
        "node": "field",
        "type": "integer",
        "widget": "input",
        "label": "Total quantity",
        "computed": "logic.totalQty(data.items)"
      },
      {
        "node": "variant",
        "path": "data.payment",
        "as": "p",
        "tag": "method",
        "widget": "inline",
        "label": "Payment",
        "cases": {
          "card": {
            "label": "Credit card",
            "body": {
              "node": "field",
              "path": "p.last4",
              "type": "text",
              "widget": "input",
              "label": "Last 4 digits",
              "constraints": {
                "pattern": "^[0-9]{4}$"
              }
            }
          },
          "wire": {
            "label": "Bank transfer",
            "body": {
              "node": "field",
              "path": "p.iban",
              "type": "text",
              "widget": "input",
              "label": "IBAN"
            }
          }
        }
      },
      {
        "node": "field",
        "path": "data.note",
        "type": "text",
        "widget": "textarea",
        "label": "Delivery note",
        "when": "logic.totalQty(data.items) > 100",
        "ui": {
          "rows": {
            "expr": "if logic.totalQty(data.items) > 1000: 6 else: 3"
          }
        }
      }
    ]
  }
}
```

### A.2 `order.gen.ista`, generated by `generate.ts`

```python
# order.gen.ista — generated from order.form.json 1.4.0. Do not edit.
#
# The generated part of a form: per form and per local def, a model (one node per path), its
# factory, what its expressions see (structs whose getters read the model, so every read is
# tracked), and a view whose expressions are closures over that scope. forms/ does the rest.
# Expressions are pasted from the schema verbatim.

import Graph from './computed'
import * as checks from './forms/checks'
import Field, Group, List, Variant, Hidden from './forms/model'
import (
  Place
  View
  Options
  Choice
  FieldView
  RepeatView
  VariantView
  CaseView
  LayoutView
) from './forms/views'
import FieldWidget, RepeatWidget, VariantWidget, LayoutWidget, ParentUi from './forms/tree'
import Form, User, Problems from './forms/form'
import * as geo from './geo'
import * as approvals from './approvals'
import * as logic from './order'

const translations: Map<String, Map<String, String>> = [
  "We don't ship to ${data.country}": ["de": "Wir liefern nicht nach $0"]
]

# ═══════════ form "order" ═══════════

struct OrderParams:
  region: String

struct OrderCtx:
  params: OrderParams
  user: User

struct OrderModel:
  country: Field<String>
  city: Hidden<Field<String>>
  items: List<OrderItemsRow>
  payment: Variant<OrderPaymentCases>
  note: Hidden<Field<String>>

type OrderItemsRow = Group<{ sku: Field<String>, qty: Field<Int> }>
type OrderPaymentCases = {
  card: Group<{ last4: Field<String> }>
  wire: Group<{ iban: Field<String> }>
}

fn orderModel(graph: Graph) -> Group<OrderModel>: Group{
  fields: OrderModel{
    country: Field.make<String>(graph)
    city: Hidden.make(graph, Field.make<String>(graph))
    items: List.make(
      graph
      fn(x): Group{
        fields: struct{sku: Field.make<String>(graph, x?.sku), qty: Field.make<Int>(graph, x?.qty)}
      }
    )
    payment: Variant{
      tag: Field.make<"card" | "wire">(graph)
      cases: struct{
        card: Group{fields: struct{last4: Field.make<String>(graph)}}
        wire: Group{fields: struct{iban: Field.make<String>(graph)}}
      }
    }
    note: Hidden.make(graph, Field.make<String>(graph))
  }
}

# What the form's expressions see as `data`.
struct OrderSeen:
  m: OrderModel

fn get country(self: OrderSeen) -> String?: self.m.country.seen()
fn get city(self: OrderSeen) -> String?: self.m.city.seen()
fn get items(self: OrderSeen) -> List<OrderItemsRow>.Seen: self.m.items.seen()
fn get payment(self: OrderSeen) -> Variant<OrderPaymentCases>.Seen: self.m.payment.seen()
fn get note(self: OrderSeen) -> String?: self.m.note.seen()

# What an `items` row's expressions see as `item`.
struct OrderItemsRowSeen:
  m: OrderItemsRow

fn get sku(self: OrderItemsRowSeen) -> String?: self.m.fields.sku.seen()
fn get qty(self: OrderItemsRowSeen) -> Int?: self.m.fields.qty.seen()

# What the `card` case's expressions see as `p`.
struct OrderPaymentCardSeen:
  m: Group<{ last4: Field<String> }>

fn get last4(self: OrderPaymentCardSeen) -> String?: self.m.fields.last4.seen()

# What the `wire` case's expressions see as `p`.
struct OrderPaymentWireSeen:
  m: Group<{ iban: Field<String> }>

fn get iban(self: OrderPaymentWireSeen) -> String?: self.m.fields.iban.seen()

fn orderView(at: Place, m: OrderModel, ctx: OrderCtx) -> View:
  const data = OrderSeen{m}
  LayoutView{
    key: "n1"
    widget: fn(): LayoutWidget.Section(
      title: "Order"
      description: none
      collapsible: none
      labels: none
    )
    checks: [
      checks.rule(
        fn(): logic.totalQty(data.items) <=
          500 or
          approvals.ask(ctx.user.id, logic.totalQty(data.items))
        fn(): `The order was not approved`
      )
    ]
    children: [
      fn(at): FieldView{
        key: "n2"
        field: m.country
        widget: fn(): FieldWidget.Select(none)
        label: fn(): "Country"
        checks: [
          checks.answered()
          checks.rule(
            fn(): not logic.isBlocked(data.country)
            fn(): checks.t(
              translations
              ctx.user.lang
              "We don't ship to ${data.country}"
              `We don't ship to ${checks.text(data.country)}`
              [checks.text(data.country)]
            )
          )
        ]
        options: Options.Rows(
          from: fn(): [
            for row in geo.countries(ctx.params.region): Choice{value: (row.id), label: (row.name)}
          ]
          resolve: fn(): geo.countries(ctx.params.region).some(fn(c): c.id == data.country)
        )
      }.build(at)
      fn(at): FieldView{
        key: "n3"
        when: fn(): data.country != none
        field: m.city.node
        hide: m.city.shown
        widget: fn(): FieldWidget.Select(none)
        label: fn(): "City"
        checks: [checks.answered()]
        options: Options.Rows(
          from: fn(): [
            for row in geo.cities(data.country ?? ""): Choice{value: (row.id), label: (row.name)}
          ]
          resolve: fn(): geo.cities(data.country ?? "").some(fn(c): c.id == data.city)
        )
      }.build(at)
      fn(at): RepeatView{
        key: "n4"
        list: m.items
        widget: fn(): RepeatWidget.Table(none)
        label: fn(): "Items"
        checks: [checks.minItems(fn(): 1)]
        canAdd: true
        item: fn(r1, row1, at): {
          const item = OrderItemsRowSeen{m: r1}
          LayoutView{
            key: `n5@${row1}`
            widget: fn(): LayoutWidget.Tablerow
            children: [
              fn(at): FieldView{
                key: `n6@${row1}`
                field: r1.fields.sku
                widget: fn(): FieldWidget.Input(none)
                label: fn(): "SKU"
                checks: [checks.required(fn(): true)]
              }.build(at)
              fn(at): FieldView{
                key: `n7@${row1}`
                parent: fn(): ParentUi.Tablerow(80)
                field: r1.fields.qty
                widget: fn(): FieldWidget.Input(none)
                label: fn(): "Qty"
                checks: [checks.answered(), checks.min(fn(): 1)]
              }.build(at)
            ]
          }.build(at)
        }
      }.build(at)
      fn(at): FieldView{
        key: "n8"
        widget: fn(): FieldWidget.Input(none)
        label: fn(): "Total quantity"
        value: fn(): logic.totalQty(data.items)
      }.build(at)
      fn(at): VariantView{
        key: "n9"
        variant: m.payment
        widget: fn(): VariantWidget.Inline
        label: fn(): "Payment"
        checks: [checks.answered()]
        cases: struct{
          card: CaseView{
            label: fn(): "Credit card"
            body: fn(at): {
              const p = OrderPaymentCardSeen{m: m.payment.cases.card}
              FieldView{
                key: "n10"
                field: m.payment.cases.card.fields.last4
                widget: fn(): FieldWidget.Input(none)
                label: fn(): "Last 4 digits"
                checks: [checks.answered(), checks.pattern(fn(): "^[0-9]{4}$")]
              }.build(at)
            }
          }
          wire: CaseView{
            label: fn(): "Bank transfer"
            body: fn(at): {
              const p = OrderPaymentWireSeen{m: m.payment.cases.wire}
              FieldView{
                key: "n11"
                field: m.payment.cases.wire.fields.iban
                widget: fn(): FieldWidget.Input(none)
                label: fn(): "IBAN"
                checks: [checks.answered()]
              }.build(at)
            }
          }
        }
      }.build(at)
      fn(at): FieldView{
        key: "n12"
        when: fn(): logic.totalQty(data.items) > 100
        field: m.note.node
        hide: m.note.shown
        widget: fn(): FieldWidget.Textarea((if logic.totalQty(data.items) > 1000: 6 else: 3))
        label: fn(): "Delivery note"
        checks: [checks.answered()]
      }.build(at)
    ]
  }.build(at)

# The form on a graph of its own.
fn openOrder(params: OrderParams, user: User) -> Form<OrderModel>:
  const graph = new Graph{}
  const model = orderModel(graph)
  Form.open(graph, model, fn(at): orderView(at, model.fields, OrderCtx{params, user}))

# ═══════════ The entry points its hosts start ═══════════

# The browser's: serves the form until a valid submit, and gives the value to submit.
live async fn orderForm(params: OrderParams, user: User) -> Group<OrderModel>.Seen:
  await openOrder(params, user).serve()

# The backend's: validates a whole value.
live fn validateOrder(
  params: OrderParams
  user: User
  value: Group<OrderModel>.Seen
) -> Result<Group<OrderModel>.Data, Problems>:
  openOrder(params, user).validate(value)
```

### A.3 `order.ista`, hand-written

```python
# order.ista — hand-written logic, called from the form's expressions. Edited by people.
# Istalang.

fn isBlocked(country: String?) -> Bool:
    country == "kp" or country == "ir"

fn totalQty(items: Array<{ sku: String?, qty: Int? }>) -> Int:
    let total = 0
    for item in items: total += item.qty ?? 0
    total
```

## Appendix B. The schema types: `form-spec.ts`

```typescript
// Form Builder Spec — the form JSON, typed for editors and agents. Checked with tsc 5.6 --strict.
// Best effort: these types catch structural mistakes; the Istalang compiler is the authority.
//
// A form is JSON, edited by a drag-and-drop editor or an agent. A generator turns each form into
// one Istalang module, and the Istalang compiler checks it. That decides the design:
//   - Nothing is parsed. Expressions are Istalang, pasted into the generated code where they sit.
//     Paths are only split on ".". A mistake surfaces as an Istalang compile error, which the
//     generator maps back to the node it came from.
//   - Every value that may be computed is a Prop: a JSON literal, or { expr }. The generator emits
//     the literal as an Istalang literal, or pastes the expression. One code path for both.
//   - Every expression's type follows from where it sits (a label is a string, `when` a bool, a
//     default the field's type), so the generator never infers a type. Options are the one place
//     an expression yields rows of an unknown type; `value` and `label` map each row right there.
//   - Types of data, of `data` in expressions, and of the output are generated Istalang types.
//     This file types only the JSON: which nodes, widgets and props fit together.
//   - Everything an expression calls returns at once: sources are functions the host
//     implements, so nothing waits and no node says how to.
// The end of this file says what each part becomes.

// ═══════════ Expressions and props ═══════════

/** An Istalang expression. In scope where it sits:
 *    data    the form's values, by path; each is none while unanswered or hidden
 *    ctx     ctx.params, ctx.user, and the variables the node's widget provides (ctx.search)
 *    the variables bound by enclosing repeats and variants (`as`)
 *    row     inside options' value and label: the row being mapped
 *    the modules in `imports`: hand-written logic and the sources the host injects.
 *  Everything it calls returns at once. */
type Expr = string;

/** A literal, or an expression. */
type Prop<T> = T | { expr: Expr };

/** Text with ${…} Istalang interpolations. Becomes an Istalang template, and its literal text is
 *  the localization key. \${ is a literal "${". */
type Template = string;

/** A name: a camelCase identifier. Becomes an Istalang name. */
type Ident = `${Letter}${string}`;
type Letter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

/** A value's address: `data` or a bound variable, then field names, joined by ".":
 *  "data.country", "item.qty". A repeat's path names the array; an item that is a single value
 *  (a multiselect's choice) has the bare variable as its path. No indexes, no [], anywhere. */
type Path = `data.${string}` | Ident;

// ═══════════ Field types and constraints ═══════════

type TextFormat = 'email' | 'uri' | 'uuid';
interface Range<V> {
  min?: Prop<V>;
  max?: Prop<V>;
}

/** The field types: the literal a default may be, whether options apply, and the constraints.
 *  Constraint values are props, so a bound can come from data ("max": { "expr": "data.budget" }). */
interface FieldTypes {
  text: {
    literal: string;
    optionable: true;
    constraints: {
      required?: Prop<boolean>;
      minLength?: Prop<number>;
      maxLength?: Prop<number>;
      pattern?: Prop<string>;
      format?: TextFormat;
    };
  };
  number: {
    literal: number;
    optionable: true;
    constraints: Range<number> & { multipleOf?: Prop<number> };
  };
  integer: {
    literal: number;
    optionable: true;
    constraints: Range<number> & { multipleOf?: Prop<number> };
  };
  boolean: { literal: boolean; optionable: false; constraints: {} };
  date: { literal: string; optionable: false; constraints: Range<string> }; // ISO date
  datetime: { literal: string; optionable: false; constraints: Range<string> }; // RFC 3339
  file: {
    literal: never;
    optionable: false;
    constraints: { accept?: readonly string[]; maxBytes?: number };
  };
}
type FieldType = keyof FieldTypes;
type Literal<T extends FieldType> = FieldTypes[T]['literal'];
type OptionableType = {
  [T in FieldType]: FieldTypes[T]['optionable'] extends true ? T : never;
}[FieldType];

/** Checked whenever what it reads changes; its message shows once the node is touched or the
 *  form submitted. */
interface Rule {
  check: Expr;
  message: Template;
}
interface Rules {
  rules?: readonly Rule[];
}
type Constraints<T extends FieldType> = Rules & FieldTypes[T]['constraints'];
interface ItemsConstraints extends Rules {
  required?: Prop<boolean>;
  minItems?: Prop<number>;
  maxItems?: Prop<number>;
}

// ═══════════ Options ═══════════

interface StaticOptions<T extends OptionableType> {
  items: readonly { value: Literal<T>; label: Prop<string> }[];
}
/** Options from rows: `from` yields them (it may call a source), `value` and `label` map each,
 *  with `row` in scope, and `resolve` checks the submitted value. rowType, an Istalang type
 *  name, is needed only to store the picked row (store "snapshot"): the field then holds the
 *  row itself, and `value` only identifies it. With a widget that provides `search`,
 *  `from` reads the typed text as ctx.search. */
interface RowOptions {
  from: Expr;
  value: Expr;
  label: Expr;
  resolve: Expr;
  rowType?: string;
}
type Options<T extends FieldType> = T extends OptionableType
  ? StaticOptions<T> | RowOptions
  : never;

// ═══════════ Widgets ═══════════
// The registry is declared by the platform and extended over time. The generator turns it into
// Istalang enums, one per node kind (FieldWidget, RepeatWidget, VariantWidget, LayoutWidget),
// one variant per widget, its ui props as the variant's fields; childUi becomes ParentUi.

type OptionsPolicy = 'none' | 'required';

interface FieldWidgetTraits {
  ownsLabel?: true; // draws its own label (a checkbox); parents don't
  provides?: object; // variables its node's expressions read as ctx.<name> (ctx.search)
  restricted?: true; // only where a parent's content policy names it
}
interface FieldWidget<
  T extends FieldType,
  O extends OptionsPolicy,
  Ui extends object,
  X extends FieldWidgetTraits = {},
> {
  kind: 'field';
  types: T;
  options: O;
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  provides: X extends { provides: infer P } ? P : {};
  placement: X extends { restricted: true } ? 'restricted' : 'anywhere';
  ui: Ui;
}

/** What a widget holds: "none", "any" node, or only nodes using the named widgets of each kind. */
type ContentPolicy = 'none' | 'any' | { fields?: string; repeats?: string; layouts?: string };

interface GroupWidgetTraits {
  ownsLabel?: true;
  childUi?: object; // what it reads from its item's (each case body's) ui.parent
  writesTag?: true; // variants: a case picker writes the tag
}
interface RepeatWidget<
  Ui extends object,
  Item extends ContentPolicy = 'any',
  X extends GroupWidgetTraits = {},
> {
  kind: 'repeat';
  item: Item;
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  childUi: X extends { childUi: infer U } ? U : {};
  ui: Ui;
}
interface VariantWidget<Ui extends object, X extends GroupWidgetTraits = {}> {
  kind: 'variant';
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  writesTag: X extends { writesTag: true } ? true : false;
  childUi: X extends { childUi: infer U } ? U : {};
  ui: Ui;
}
interface LayoutWidgetTraits {
  restricted?: true;
  control?: true; // draws its raw/choice children as one control (a money input); takes a label
}
interface LayoutWidget<
  Children extends ContentPolicy,
  Ui extends object,
  ChildUi extends object = {},
  X extends LayoutWidgetTraits = {},
> {
  kind: 'layout';
  children: Children;
  childUi: ChildUi;
  placement: X extends { restricted: true } ? 'restricted' : 'anywhere';
  control: X extends { control: true } ? true : false;
  ui: Ui;
}

type Orientation = { orientation?: 'horizontal' | 'vertical' };
type Placeholder = { placeholder?: string };
type Labels = { labels?: 'top' | 'start' | 'hidden' };

interface Widgets {
  input: FieldWidget<'text' | 'number' | 'integer', 'none', Placeholder>;
  textarea: FieldWidget<'text', 'none', { rows?: number }>;
  select: FieldWidget<OptionableType, 'required', Placeholder>;
  autocomplete: FieldWidget<
    OptionableType,
    'required',
    Placeholder,
    { provides: { search: string } }
  >;
  radio: FieldWidget<OptionableType, 'required', Orientation>;
  segmented: FieldWidget<OptionableType, 'required', {}>;
  checkbox: FieldWidget<'boolean', 'none', {}, { ownsLabel: true }>;
  toggle: FieldWidget<'boolean', 'none', {}, { ownsLabel: true }>;
  datepicker: FieldWidget<'date' | 'datetime', 'none', {}>;
  upload: FieldWidget<'file', 'none', { dropzone?: boolean }>;
  choice: FieldWidget<OptionableType, 'required', {}, { restricted: true }>;
  raw: FieldWidget<FieldType, 'none', {}, { restricted: true }>;
  multiselect: RepeatWidget<Placeholder, { fields: 'choice' }>;
  checkboxes: RepeatWidget<Orientation, { fields: 'choice' }>;
  list: RepeatWidget<{ addLabel?: string; reorderable?: boolean }>;
  table: RepeatWidget<{ addLabel?: string }, { layouts: 'tablerow' }>;
  cards: RepeatWidget<{ addLabel?: string; title?: string }>;
  inline: VariantWidget<{}, { writesTag: true }>;
  panel: VariantWidget<{ title?: string }>;
  section: LayoutWidget<
    'any',
    { title?: string; description?: string; collapsible?: boolean } & Labels,
    { span?: 1 | 2 }
  >;
  labeled: LayoutWidget<'any', Labels>;
  /** A composite control: an amount and a currency drawn as one input. */
  money: LayoutWidget<{ fields: 'raw' | 'choice' }, {}, {}, { control: true }>;
  hstack: LayoutWidget<'any', { gap?: 'sm' | 'md' | 'lg' } & Labels, { grow?: number }>;
  wizard: LayoutWidget<{ layouts: 'step' }, {}>;
  step: LayoutWidget<'any', { title: string } & Labels, {}, { restricted: true }>;
  tablerow: LayoutWidget<
    {
      fields: 'input' | 'select' | 'autocomplete' | 'checkbox' | 'toggle' | 'datepicker';
      repeats: 'multiselect';
    },
    {},
    { width?: number },
    { restricted: true }
  >;
  markdown: LayoutWidget<'none', { markdown: string }>;
  errors: LayoutWidget<'none', {}>;
  divider: LayoutWidget<'none', {}>;
}
type WidgetId = keyof Widgets;
type WidgetKind = Widgets[WidgetId]['kind'];
type WidgetsOfKind<K extends WidgetKind> = {
  [W in WidgetId]: Widgets[W]['kind'] extends K ? W : never;
}[WidgetId];
type FieldWidgetId = WidgetsOfKind<'field'>;
type RepeatWidgetId = WidgetsOfKind<'repeat'>;
type VariantWidgetId = WidgetsOfKind<'variant'>;
type LayoutWidgetId = WidgetsOfKind<'layout'>;
type FreeFieldWidgetId = {
  [W in FieldWidgetId]: Widgets[W]['placement'] extends 'anywhere' ? W : never;
}[FieldWidgetId];
type FreeLayoutWidgetId = {
  [W in LayoutWidgetId]: Widgets[W]['placement'] extends 'anywhere' ? W : never;
}[LayoutWidgetId];
type FieldWidgetFor<T extends FieldType> = {
  [W in FieldWidgetId]: T extends Widgets[W]['types'] ? W : never;
}[FieldWidgetId];

/** ui: the widget's props, each a Prop, plus `parent`: what the parent widget reads about this
 *  node. Required when any prop is. `parent` is a reserved name. */
type PropsOf<U> = { [K in keyof U]: Prop<Exclude<U[K], undefined>> };
type UiSlot<W extends WidgetId> = {} extends Widgets[W]['ui']
  ? { ui?: PropsOf<Widgets[W]['ui']> }
  : { ui: PropsOf<Widgets[W]['ui']> };
type ParentUiSlot<ChildUi> = keyof ChildUi extends never
  ? {}
  : {} extends ChildUi
    ? { ui?: { parent?: PropsOf<ChildUi> } }
    : { ui: { parent: PropsOf<ChildUi> } };

// ═══════════ Nodes ═══════════

/** Any node that may stand on its own. Restricted widgets appear only where a parent names them. */
type Node =
  | FieldNodeUsing<FreeFieldWidgetId>
  | RepeatNode
  | VariantNode
  | RefNode
  | LayoutNode<FreeLayoutWidgetId>;

type Content<P> = P extends 'any'
  ? Node
  :
      | (P extends { fields: infer F extends FieldWidgetId } ? FieldNodeUsing<F> : never)
      | (P extends { repeats: infer R extends RepeatWidgetId } ? RepeatNode<R> : never)
      | (P extends { layouts: infer L extends LayoutWidgetId } ? LayoutNode<L> : never);

interface NodeBase {
  /** A hidden node doesn't exist: not drawn, validated, stored, or seen by expressions.
   *  A `when` sees the values of nodes before it in the tree. */
  when?: Expr;
}

type Store = 'value' | 'none' | 'snapshot';

// ── field ──
type FieldNodeUsing<F extends FieldWidgetId> = {
  [T in FieldType]: FieldNode<T, F & FieldWidgetFor<T>>;
}[FieldType];
type FieldNode<T extends FieldType, W extends FieldWidgetFor<T>> = {
  [K in W]: FieldNodeOf<T, K>;
}[W];

type FieldNodeOf<T extends FieldType, W extends FieldWidgetFor<T>> = NodeBase & {
  node: 'field';
  type: T;
  widget: W;
  label: Prop<string>;
  help?: Prop<string>;
  constraints?: Constraints<T>;
} & FieldData<T, Widgets[W]['options'] extends 'none' ? 'value' | 'none' : Store> &
  UiSlot<W> &
  OptionsSlot<T, W>;

/** With a path, the value is stored there. Without one, the field only shows `computed`.
 *  default: the initial value; computed: always derived, read-only. */
type FieldData<T extends FieldType, S extends Store> =
  | ({ path: Path; store?: S } & (
      | { default?: Prop<Literal<T>>; computed?: never }
      | { computed: Expr; default?: never }
    ))
  | { path?: never; store?: never; default?: never; computed: Expr };

type OptionsSlot<
  T extends FieldType,
  W extends FieldWidgetId,
> = Widgets[W]['options'] extends 'required' ? { options: Options<T> } : { options?: never };

// ── repeat ──
type RepeatNode<W extends RepeatWidgetId = RepeatWidgetId> = {
  [K in W]: RepeatNodeOf<K> & UiSlot<K> & RepeatData;
}[W];

interface RepeatNodeOf<W extends RepeatWidgetId> extends NodeBase {
  node: 'repeat';
  path: Path;
  as: Ident;
  widget: W;
  label?: Prop<string>;
  item: Content<Widgets[W]['item']> & ParentUiSlot<Widgets[W]['childUi']>;
  /** Identifies rows that come from a default or computed list (`as` in scope), so filled-in
   *  cells follow their row. Rows the user adds are keyed by the instance. */
  rowKey?: Expr;
  /** With a computed default: "rows-edited" stops re-running it once a row is added or
   *  removed; "any-edit" at any change inside. */
  recomputeUntil?: 'rows-edited' | 'any-edit';
}
type Rows = Prop<readonly object[]>;
type RepeatData = { store?: 'value' | 'none' } & (
  | { editableCount?: true; default?: Rows; computed?: never; constraints?: ItemsConstraints }
  | { editableCount: false; default: Rows; computed?: never; constraints?: Rules }
  | { computed: Expr; default?: never; editableCount?: never; constraints?: Rules }
);

// ── variant ──
type VariantNode<W extends VariantWidgetId = VariantWidgetId> = {
  [K in W]: VariantNodeOf<K> & UiSlot<K> & VariantData;
}[W];

interface VariantNodeOf<W extends VariantWidgetId> extends NodeBase {
  node: 'variant';
  path: Path;
  as: Ident;
  widget: W;
  label?: Prop<string>;
  /** The tag's field name inside the variant. Anyone may write it: a picker, or any field. */
  tag: Ident;
  cases: {
    readonly [id: string]: {
      label: Prop<string>;
      body: Node & ParentUiSlot<Widgets[W]['childUi']>;
    };
  };
  constraints?: Rules;
}
type VariantData = { store?: 'value' | 'none' } & (
  | { default?: Prop<string>; computed?: never } // a case id
  | { computed: Expr; default?: never }
);

// ── ref ──
/** Mounts a form: a sealed black box. A static ref names a catalog form or a local def and passes
 *  params; the mounted form draws itself. A dynamic ref mounts the form an expression yields, under
 *  its label. */
type RefNode = NodeBase & {
  node: 'ref';
  path: Path;
} & (
    | {
        form: FormRef;
        params?: { readonly [name: string]: Prop<unknown> };
        schema?: never;
        label?: never;
      }
    | { schema: Expr; label?: Prop<string>; form?: never; params?: never }
  );

type FormRef = `catalog:${string}@${string}` | `#${string}`;

// ── layout ──
type LayoutNode<W extends LayoutWidgetId = LayoutWidgetId> = {
  [K in W]: LayoutNodeOf<K> &
    ChildrenSlot<Widgets[K]['children'], Widgets[K]['childUi']> &
    UiSlot<K> &
    (Widgets[K]['control'] extends true ? { label: Prop<string> } : { label?: never });
}[W];

interface LayoutNodeOf<W extends LayoutWidgetId> extends NodeBase {
  node: 'layout';
  widget: W;
  constraints?: Rules;
}
type ChildrenSlot<P, ChildUi> = P extends 'none' ? { children?: never } : Children<P, ChildUi>;
interface Children<P, ChildUi> {
  children: readonly (Content<P> & ParentUiSlot<ChildUi>)[];
}

// ═══════════ Form document ═══════════

/** A declared type: a field type (with constraints), a literal set, an array, an object,
 *  or any Istalang type by name ({ ista: "geo.Country" }). */
type TypeDecl =
  | FieldType
  | { [T in FieldType]: { type: T } & Constraints<T> }[FieldType]
  | { type: 'literal'; values: readonly (string | number | boolean)[] }
  | { type: 'array'; items: TypeDecl }
  | { type: 'object'; properties: { readonly [name: string]: TypeDecl } }
  | { ista: string };

interface FormDef {
  params?: { readonly [name: string]: TypeDecl };
  /** Assigns a path's type; every writer must conform. Undeclared: the intersection of what its
   *  writers produce. Validation is always the union of all their constraints and rules. */
  types?: { readonly [path: string]: TypeDecl };
  root: Node;
}

interface FormDocument extends FormDef {
  id: string;
  version: SemVer;
  /** Modules the expressions use, by alias: hand-written logic and sources.
   *  { "geo": "geo", "logic": "./order" } → import * as geo from 'geo', … */
  imports?: { readonly [alias: string]: string };
  defs?: { readonly [name: string]: FormDef };
  /** Translations, by original Template, then language: $0…$n are its ${…} in order. */
  localization?: { readonly [original: string]: { readonly [lang: string]: string } };
}

/** patch: output type unchanged; minor: still accepts old values; major: anything else,
 *  including a changed condition or stored computed expression. Defaults never bump it. */
type SemVer = `${number}.${number}.${number}`;
```

