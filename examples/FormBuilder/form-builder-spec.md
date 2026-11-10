---
description: specification and Istalang implementation design of the schema-based form builder — schema, code generator, generic runtime, and acceptance scenarios
owner: tech-lead
status: active
applies_to: examples/FormBuilder
last_verified: 2026-11-05
last_updated: 2026-11-11
tags: [form-builder, specification, istalang]
---

# Form Builder: Specification and Istalang Implementation

This document specifies a form builder whose forms are data, edited by people in a drag-and-drop editor and by agents, and run as Istalang code. It covers the problem, the form schema, how a form becomes Istalang, the runtime that runs every form, and the language features the design relies on. It is written for the agent implementing Istalang, and doubles as an end-to-end test of the language's expressiveness: the two example forms exercise every part of the design, and §9 gives acceptance scenarios.

**Status of the companion code.** The TypeScript files (`form-spec.ts`, `form-spec.test.ts`, `generate.ts`) compile under `tsc --strict`, the spec tests pass, and the generator produces the two `.gen.ista` files from the two `.form.json` files. The Istalang files (`forms.ista`, `*.gen.ista`, `order.ista`, `supplier.ista`) are checked against the Istalang compiler; see `ista-alignment.md` for the alignment report.

| File | What it is |
| --- | --- |
| `form-builder-spec.md` | This document |
| `ista-alignment.md` | Alignment of the prototype with the Istalang specification and compiler |
| `form-spec.ts` | The form schema as TypeScript types (also in §4.8) |
| `form-spec.test.ts` | Type tests: both example forms, and 14 forms that must be rejected |
| `generate.ts` | The generator: form JSON → Istalang module |
| `forms.ista` | The runtime: the `forms` Istalang module every form uses |
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
                     forms.ista (the runtime, written once) ────────────┘
```

**The JSON is the source of truth**, typed in TypeScript (`form-spec.ts`) for editors and agents. The types catch structural mistakes. Expressions inside the JSON are Istalang, and the Istalang compiler checks them.

**The generator never parses an expression.** It pastes each one into a lambda. Its only text handling is splitting paths on `.`, finding the `await` keyword, and finding the `${…}` spans of a message template.

**A form's generated module is declarative.** For the form, and for each local def, it holds:

- a **model**: a struct with one node per path, which holds the values;
- the model's **factory**;
- a **view**: a static tree of view nodes, with every expression as a lambda.

There is no generated control flow: no rendering, validation or event code.

**The runtime (`forms`) is generic.** It holds the loop, drawing, validation, event routing, tasks for awaited expressions, and reading the result.

**Types are computed, not generated.** Every model node declares two associated types:

- `Data`: what a submission holds;
- `Seen`: what expressions see, where anything unanswered or hidden is `none`.

They compose through the tree with mapped types, so `OrderData = Group<OrderModel>.Data` is the form's result type, written by nobody.

**A form is an `async fn`.** A workflow writes `const order = await orderForm(params, user, events, views)` and receives `OrderData`. The form runs as an instance:
1. It draws its view and sends the tree to the frontend through an inbox.
2. It waits for the next event on another inbox.
3. It repeats until a valid submit, then returns the data.

## 3. Architecture and lifecycle

**Editing.** The editor and agents edit the JSON, and `form-spec.ts` validates it as they go. Editing labels, layout, widgets, literals or options changes only the JSON. Changing an expression or a path changes the generated module, which must be recompiled.

**Compiling.** The generator emits the module. The Istalang compiler then compiles it together with `forms` and the form's `imports`. A running interpreter cannot load new modules, so every change produces a new program version.

**Previewing.** The editor's preview restarts the form's instance on each new version and replays the events recorded so far, so the preview keeps what the user has typed.

**Running.** The form runs in the browser, in the TypeScript interpreter, inside a Web Worker. Events from the frontend go into the `events` inbox, and view trees come back through the `views` inbox.
- **Rendering:** the frontend renders each tree with React, keyed by node key. The interpreter's bridge returns the same JavaScript reference for a shared struct as long as it hasn't changed, so React's memoization works without a diffing pass.
- **Drafts:** a partly filled form may be saved at any time; drafts are not validated.

**Submitting.** The host records every event. On submit it sends the event log to the server, which runs the same form version and replays the log. Istalang is deterministic and sources record their results, so the replay reproduces the state; where a source answers differently, the server's result wins. A submission whose rules wait for an approval stays open in the server's durable instance until the approval arrives.

**Consuming.** A workflow awaits the form's entry point and gets its typed `Data`.

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

An expression may `await`; see §4.3.

A **prop** (`Prop<T>`) is anything that may be computed: a JSON literal, or `{ "expr": "…" }`. The generator emits a literal as an Istalang literal and pastes an expression into a lambda; both take the same path. Props include:
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

### 4.3 Waiting: `pending`

Sources are async functions the host injects. They cache their own results, so repeating a call is cheap. Any expression may `await` one, or anything else.

A node's `pending` says how its expressions wait:

| `pending` | Behaviour |
| --- | --- |
| `form` (default) | Awaited inline: the whole form waits, and the host shows it busy. |
| `node` | Each awaited expression runs in its own task. The node shows a loading state, and the result arrives like a user's edit. |
| `hidden` | Like `node`, but the node stays hidden until the result arrives. |

A **rule with `pending`** waits differently. An approval should not run while the user types, so such a rule:
1. starts in its own task once the user submits;
2. blocks submission until it resolves, showing the pending text.

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
- `from` yields rows, and may await a source.
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
- `pending`: §4.3.

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
- **Static ref:** `form` is a catalog form (`catalog:contact-card@^1`) or a local def (`#address`), with `params`.
- **Dynamic ref:** `schema` is an expression yielding a compiled form chosen at run time. Its data is opaque, and no expression outside it reads it.
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
| Params and ctx structs | `struct OrderParams: region: String`, `struct OrderCtx { params: OrderParams, user: User }` |
| The model struct: one node per top-level path | `struct OrderModel { country: Field<String>, city: Hidden<Field<String>>, items: List<OrderItemsRow>, … }` |
| Aliases for row and case types | `type OrderItemsRow = Group<{ sku: Field<String>, qty: Field<Int> }>` |
| The factory | `fn orderModel() -> Group<OrderModel>` |
| The view, its signature naming the scope | `fn orderView(m: OrderModel) -> any View<Scope<Group<OrderModel>.Seen, OrderCtx>>`; for a def, `fn addressView(m: AddressModel, k: String)`, with `k` prefixing its keys |
| For the form only, the entry point | `async fn orderForm(params, user, events, views)`, giving `Group<OrderModel>.Data` |

It also emits the `imports`, an import per catalog form (`import * as contactCard from 'catalog/contact-card@^1'`; a catalog form is a compiled module exporting `Model`, `Params`, `Ctx`, `model()` and `view()`), and the localization table.

### 5.2 Deriving the model

Pass 1 walks the tree and builds the model from the paths. It first creates the structural nodes (repeats, variants, mounts), so a field writing a variant's tag finds the variant, then the fields.

| Schema | Model node |
| --- | --- |
| A field's path | `Field<T>`, `T` from the field type: `String`, `Float`, `Int`, `Bool`, `forms.Date`, `forms.DateTime`, `forms.FileId` |
| Static options on every writer | `Field<"a" \| "b">`, the intersection of the writers' values |
| `store: "snapshot"` | `Field<rowType>` |
| A `types` entry | its declared type |
| Intermediate path segments | `Group<{ … }>` |
| A repeat | `List<Row>`, where `Row` is `Group<{ … }>`, a single `Field<T>` (an item whose path is the variable), or a mounted form |
| A variant | `Variant<Cases>`, `Cases` a struct of case-name → `Group<{ … }>`; its tag is `Field<"card" \| "wire">` |
| A static ref | the def's or catalog form's `Group<Model>` |
| A dynamic ref | `Dynamic` |
| `store: "none"` | `Local<N>`: seen by expressions, validated, not output |
| Every writer of a path can be hidden by a `when` (its own or an ancestor's, up to the nearest repeat or variant), or has `pending: "hidden"` | wrapped in `Hidden<N>`, whose `Data` is optional |

The model's fields follow the order in which the schema first mentions each path.

### 5.3 Generating the view

Pass 2 walks the tree again and emits a view node per schema node.

| Schema | View node |
| --- | --- |
| layout | `LayoutView` |
| field | `new FieldView`, holding the model's `Field` handle (or `none` when pathless) and, if hideable, its `Hidden` |
| repeat | `new RepeatView`, whose `item` builds a row's view from the row's node and key |
| variant | `VariantView` with a `CaseView` per case |
| static ref | `ScopedView` into the mounted form's own scope, built from its params |
| dynamic ref | `new DynamicView` |

No view node or lambda names a type: the checker infers each view's scope `Sc` and value type from
the view function's signature and the model nodes it holds, and each lambda's parameters from the
view it is given to.

Its rules:

- **Props.** A literal becomes `Prop.Fixed(…)` (or bare `Fixed(…)` inside check calls). An expression becomes `Prop.Computed(fn({data, ctx}): <expr>)`. If the expression contains `await`, it becomes `forms.awaited(Pending.X, async fn({data, ctx}): <expr>)` instead, which owns a task.
- **Widgets.** The widget and its ui props become one prop: `Prop.Fixed(FieldWidget.Select(none))`. If any ui prop is computed, so is the whole widget value.
- **Lambdas.** A lambda takes its scope through a parameter pattern, `fn({data, ctx, item})`, so pasted expressions read bare names.
- **Scopes.** A repeat row, a variant case and a mount each get a wider scope: the outer variables plus the new one. Drawing moves into it through a `ScopedView`, whose `scope` builds it, for example `fn(sc): struct{data: sc.data, ctx: sc.ctx, item: r1.seen()}`. The views inside take the struct it builds as their scope.
- **Keys.** Nodes are numbered in tree order: `n1`, `n2`… A key inside a repeat row adds the row's key (`n6@r1`; nested rows `n9@r1@r2`), and inside a mounted def its mount's key (`n4/n2`). Keys are stable within a version.
- **Checks.**
  - Every stored field without a default or computed value gets `forms.answered()`.
  - Each constraint becomes a helper call with prop arguments (`forms.maxLength(Fixed(120))`), including those from the path's `types` entry.
  - A rule becomes `forms.rule(check, message)`.
  - A rule with `pending` becomes `forms.later(test, pendingText)`.
- **Options.**
  - Static options become `Options.Items`.
  - Options from rows become `Options.Rows`, where `from` is `[for row in <from>: Choice{value: <value>, label: <label>}]`.
  - With a search widget they become `Options.Search`, whose `from` takes the typed text and widens `ctx` with `const ctx = struct{search, for k, v in ...sc.ctx: [k]: v}`.
- **Templates.** A message template becomes a template literal with each `${…}` wrapped in `forms.text(…)`. If the form translates it, it becomes ``forms.t(translations, ctx.user.lang, "<original>", `<rendered>`, [forms.text(arg0), …])``. A string literal that has a translation (a label, a section title) becomes such a call too.

## 6. The runtime

`forms.ista` is the runtime; this section summarizes it.

### 6.1 The model

Every model node implements `FormNode`, with associated types `Data` and `Seen` and methods `seen()`, `read() -> Result<Data>` and `load(Seen)`.

| Node | Data | Seen | Notes |
| --- | --- | --- | --- |
| `Field<T>` (shared) | `T` | `T?` | Holds the value, `touched`, `edited`, `parseError` |
| `Group<S>` | `{ [F in keyof S]: S[F].Data }` (via `type match`) | the same, with `Seen` | |
| `List<R>` (shared) | `Array<R.Data>` | `Array<R.Seen>` | Rows created from `make`; `sync` matches rows from data by key |
| `Variant<C>` | `{ tag: keyof C, value: { [K in keyof C]: C[K].Data? } }` | `{ tag: (keyof C)?, value: { [K in keyof C]: C[K].Seen? } }` | The tag is a `Field<keyof C>` |
| `Hidden<N>` (shared) | `N.Data?` | `N.Seen?` | Drawing sets `shown` when any writer is drawn |
| `Local<N>` (shared) | `None` | `N.Seen` | Kept out of the output |
| `Dynamic` (shared) | `String` (JSON) | `None` | A mounted dynamic form's data, opaque |

**Fields are shared structs.** The model and every view writing a path hold the same handle. That handle is all multiple writers and outside tag writers need: two `FieldView`s holding one `Field`.

**Constraints and `when`s live in the view, not the model.** The model's types determine `Seen`, and expressions take `Seen`. A lambda stored in the model would make the model's type depend on itself.

### 6.2 The view

Every view node implements `View<Sc>`, with `ista fn draw(sc, &out) -> Array<Node>`. Drawing never awaits, because each await of a live run ends a segment, which costs more than the drawing. It returns zero nodes when hidden, a `Loading` node while waiting, and otherwise its node, and it records in `out`:
- inputs to route events to, by key;
- lists to add rows to and remove rows from;
- whether everything is valid;
- which `Hidden`s were shown;
- the runs the form waits for.

The view nodes are `FieldView`, `RepeatView`, `VariantView` (with `CaseView`s), `LayoutView`, `ScopedView` (which moves into another scope) and `DynamicView`.

**Props.** `Prop<Sc, T>` is `Fixed`, `Computed` (a lambda) or `Awaited` (an async lambda with its pending behaviour and a `Task`).
- **Pending `form`:** `peek()` returns the value its task kept for the current scope. For a new scope it queues the lambda's run in `out`, which the loop awaits before drawing again, so the whole form waits.
- **Pending `node` / `hidden`:** `peek()` starts the lambda in its task when the scope it last ran with differs from the current one, and returns the task's value (`none` while running). The task sends `Resolved` to the events inbox when it finishes, which causes a redraw. Because the task re-runs only when its scope changes, a finished task never restarts on the redraw it caused. Sources cache, so re-running after a change is cheap.

**Checks.**
- `Check.Now` runs on every draw.
- `Check.Later` (a rule with `pending`) runs as a task once the form is submitted. The form isn't valid until it resolves, and its pending text is shown meanwhile.

**Repeat rows.** A repeat builds each row's view once, when the row first appears, and keeps it by row key, so the view tree stays static per row.
- **Default rows:** `RepeatView.rows` loads a default once, or re-runs a computed default until `recomputeUntil`.
- **Computed rows** follow `rows` on every draw.
- **Keys:** with a `rowKey`, rows are matched with `List.sync`, which keeps the nodes, and so the values, of rows whose key stays.

### 6.3 The loop

`forms.run(model, view, ctx, translations, events, views)`:

1. **Draw.** Draw with scope `Scope{data: model.seen(), ctx}`. Await what the drawing queued, then draw again; and if drawing changed what `data` holds (a `Hidden` flipped, a computed value was written), draw again too, up to eight passes in all. That lets a `when` depend on another node's visibility. Exceeding the limit means the form's conditions cycle.
2. **Return.** If the form was submitted and the drawing is valid, return `model.read()`: the typed `Group<M>.Data`.
3. **Send** the tree to the `views` inbox.
4. **Wait** for the next event:
   - `Set(key, value)` routes to the input registered under `key`, which parses the JSON value into its type.
   - `Search(key, text)` stores the typed text. The field's options run again, as a queued run, whenever the text or the scope changed.
   - `AddRow` and `RemoveRow` change a list.
   - `Submit` marks the form submitted.
   - `Resolved` just redraws.

### 6.4 What the frontend receives

A `Node` tree:
- `Layout`, `Field`, `Repeat` (with `Row`s), `Variant`, `Mount` and `Loading`;
- each node has its key, its widget enum value with evaluated ui props, `ParentUi`, label, errors and pending texts;
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
| One generic loop, redrawing the whole tree | Simpler than dependency tracking, and React plus the bridge's stable references make redraws cheap |
| Server replays events on submit | One code path; the server's result is authoritative |
| Awaited props re-run only when their scope changes | Sources cache, so no dependency declarations are needed and no redraw loop can occur |

## 8. Language features the design relies on

The design uses Istalang as the guide describes it: structs, enums, generics, traits with associated types, struct constraints, mapped struct types, field loops, `keyof`, literal unions, `any Trait`, shared structs, inboxes, async functions and durable awaits. It also relies on the following, which the guide doesn't show. Each is marked `ASSUMES` in `forms.py` or used by the generated code. Where a fallback exists, it is noted.

| # | Feature | Used for | Example | Fallback |
| --- | --- | --- | --- | --- |
| 1 | Mapped struct literal: build a value field by field | `Group.seen()`, `read()` | `{ for f, node in ...self.fields: [f]: node.seen() }` | None found: needed to stay generic |
| 2 | A mapped type indexed by the union of its keys yields a union | `Variant<C>.Data` | `{ [K in keyof C]: { case: K, value: … } }[keyof C]` | A struct `{ case: keyof C, value: { [K in keyof C]: …? } }` |
| 3 | Reading a struct field with a union-typed key value | `Variant.read()` | `self.cases[k]` where `k: keyof C` | A field loop with `if f == k` |
| 4 | Indexed access on a type by a literal key | Nothing generated: case scopes are inferred (§5.3) | `Group<OrderPaymentCases["card"]>.Seen` | Generate a named alias per case |
| 5 | Top-level type aliases, including generic ones | Row and case types | `type OrderItemsRow = Group<{ sku: Field<String>, qty: Field<Int> }>` | Associated types on a generated struct |
| 6 | Constructing a value by an alias of an anonymous struct type | Nothing generated: scope functions build `struct{…}` (§5.3) | `OrderScope1{data: sc.data, ctx: sc.ctx, item: r1.seen()}` | An expected-type annotation on the lambda |
| 7 | Async lambdas | Awaited props, pending rules, search options | `async fn({data, ctx}): await geo.cities(…)` | None found |
| 8 | Struct patterns as lambda parameters | Every pasted expression reads bare `data`, `ctx`, variables | `fn({data, ctx, item}): item.qty > 0` | `fn(s): { const data = s.data … }` |
| 9 | Generic traits and `any Trait<P>` over generic structs | `any View<Sc>` children of mixed node types | `children: Array<any View<Sc>>` | None found: central to the design |
| 10 | Async trait methods, and trait impls for generic structs | `View.draw` | `impl View<Sc> for FieldView<Sc, T>` | None found |
| 11 | Spreading a struct into an anonymous struct literal | `ctx` widened with `search` | `{ ...sc.ctx, search }` | A generated ctx struct per search widget |
| 12 | Structural `==` on structs and computed types | A task re-runs when its scope changes; the loop stops redrawing when `data` stops changing | `if task->sc != sc: …` | Compare JSON strings |
| 13 | Parsing JSON into literal unions and computed types | Events set a tag; snapshots | `json.parse<"card" \| "wire">(v)` | Parse a string, then match |
| 14 | Recursive types through generic containers | A def mounting itself | `struct CategoryModel: children: List<Group<CategoryModel>>` | None needed if supported |
| 15 | Struct constraints satisfied by nested anonymous structs of generic nodes | `Group<{ a: Field<String>, b: Hidden<Field<Int>> }>` | `S is struct { [_] is FormNode }` | None found |
| 16 | Implicit conversion of a shared struct to `any Trait` it implements | `hide: m.city` into `(any Showable)?` | | An explicit conversion call |
| 17 | Empty struct declarations | Params of a def with none | `struct CategoryParams {}` | A `Unit` field |
| 18 (nice to have) | Lambda parameter types inferred from the expected type | Shorter generated code | | Already spelled out |

**The host must also provide:**
- inboxes between the instance and the frontend;
- the bridge's stable references for unchanged shared structs;
- injected async sources with caching;
- for dynamic refs, a way to run a separately compiled form and mount its view. A running interpreter can't load modules, so the host runs the mounted form as its own instance, and the parent stores its result JSON in a `Dynamic`.

## 9. Acceptance scenarios

These exercise the order form (Appendix A) end to end. Run them in the interpreter with the sources mocked as given, sending events into `events`, and compare the views and the returned data.

**Mocked sources** (`geo`, `approvals`):
- `geo.countries("eu")` returns `[{id: "de", name: "Germany"}, {id: "kp", name: "North Korea"}]`.
- `geo.cities("de")` resolves after one tick with `[{id: "ber", name: "Berlin"}]`.
- `approvals.ask(…)` stays pending until the test resolves it.

Params: `{region: "eu"}`. User: `{id: "u1", name: "Ana", lang: "de", role: "buyer", today: "2026-11-05"}`.

**S1. The first view.** Start the form.
- **Expected tree:** the section `n1` with:
  - `n2` Country, a select with two options;
  - `n4`, an empty table that can add rows;
  - `n8` Total quantity = 0, read-only;
  - `n9` Payment, an inline picker with no active case.
- **Not present:** `n3` City (no country yet) and `n12` (total ≤ 100).
- **Errors:** none shown (nothing touched, not submitted).

**S2. Dependent loading.**
1. `Set{key: "n2", value: "\"de\""}`: `n3` appears as a `Loading` node (`pending: "node"`).
2. After the tick and `Resolved`: `n3` is a select with Berlin.

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

**S6. Approval blocks submission.**
1. As S5, but with quantities totalling 600, and the note filled.
2. On `Submit`: the tree shows `n1` waiting with "Waiting for approval of a large order", and the form doesn't return.
3. Resolve `approvals.ask` with `true`: the form returns. With `false`: `n1` shows "The order was not approved", and the form waits for another submit.

**S7. Validation messages.**
1. `Submit` on an empty form: every stored field shows "Required", and `n4` shows its minItems error.
2. `Set n10 "12a4"`: `n10` shows the pattern error.

**S8. Server replay.** Replay S5's event log on a fresh instance: the same `OrderData`.

The supplier form (`supplier.form.json`) is the full test. It compiles only if every feature in §4 and §8 works. Its coverage:

| Feature | Where in the supplier form |
| --- | --- |
| Wizard, steps, markdown with computed text | Root; Company step's welcome text |
| `section` (title, description, collapsible), `hstack` with `ui.parent.grow`, `labeled` with `labels` | Company section; name and VAT ID; the address def |
| Every field type | text, number (capital), integer (employees), boolean (agree, primary), date (founded), datetime (express delivery), file (logo) |
| Every constraint | minLength/maxLength/pattern/format, min/max/multipleOf, date bounds from `ctx`, accept/maxBytes, minItems/maxItems/required on repeats |
| Computed bounds and conditional `required` | `employees.max`, `contacts.maxItems`, `notes.required` |
| Rules: on a field, cross-field, with a localized template, pending approval | `confirmEmail`, `employees`, the Review step's `errors` node |
| `store: "none"`, `store: "snapshot"` with `rowType`, pathless computed, stored computed | `confirmEmail`; `manager`, `extraForm`; catalog value; `score` |
| Literal and expression defaults; awaited default with `pending: "hidden"` | description, size, terms; `creditLimit` |
| Static options with a computed label; options from sources; resolve | size; countries, cities, regions |
| Autocomplete providing `ctx.search` | account manager |
| `pending: "form"`, `"node"`, `"hidden"` | country; main city; credit limit and order history |
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
| Localization of labels, ui props and templates | "Company"; employees rule; approval pending text |
| Label as an expression | notes |
| Divider, errors widget | Review step |

## 10. Open points

- **Dynamic refs:** the host protocol for running a mounted form as its own instance and embedding its view tree needs specifying.
- **Recursion bounds:** recursion through refs is assumed to end because repeats start empty; the generator does not yet reject unbounded recursion.
- **Bounded redraws:** the loop's limit of eight passes (for `when` chains and rounds of waits) is arbitrary.
- **Re-running approvals:** an approval rule re-runs if the data changes after submit, because its task is keyed by the whole scope. That is intended (the approved data changed), but it means a fresh request.
- **Snapshot comparison:** `Options.Search.same` compares snapshots by an `id` field. The generator assumes snapshot rows have one.

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
          "check": "logic.totalQty(data.items) <= 500 or await approvals.ask(ctx.user.id, logic.totalQty(data.items))",
          "message": "The order was not approved",
          "pending": "Waiting for approval of a large order"
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
          "from": "await geo.countries(ctx.params.region)",
          "value": "row.id",
          "label": "row.name",
          "resolve": "(await geo.countries(ctx.params.region)).some(fn c: c.id == data.country)"
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
        "pending": "node",
        "options": {
          "from": "await geo.cities(data.country ?? \"\")",
          "value": "row.id",
          "label": "row.name",
          "resolve": "(await geo.cities(data.country ?? \"\")).some(fn c: c.id == data.city)"
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
# factory, and a view whose expressions are lambdas. forms.run does the rest.
# Expressions are pasted from the schema verbatim.

import Inbox from 'inbox'
import * as forms from './forms'
import (
  Field
  Group
  List
  Variant
  Hidden
  Local
  Dynamic
  Scope
  Prop
  Pending
  Check
  Recompute
) from './forms'
import (
  Options
  Item
  Choice
  Format
  FieldView
  RepeatView
  VariantView
  CaseView
  LayoutView
) from './forms'
import ScopedView, DynamicView, View, FormEvent, Node, User from './forms'
import (
  FieldWidget
  RepeatWidget
  VariantWidget
  LayoutWidget
  ParentUi
  LabelStyle
  Orientation
  Gap
) from './forms'
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

fn orderModel() -> Group<OrderModel>: Group{
  fields: OrderModel{
    country: new Field<String>{}
    city: new Hidden<Field<String>>{node: new Field<String>{}}
    items: new List<OrderItemsRow>{
      make: fn(): Group{fields: struct{sku: new Field<String>{}, qty: new Field<Int>{}}}
    }
    payment: Variant{
      tag: new Field<"card" | "wire">{}
      cases: struct{
        card: Group{fields: struct{last4: new Field<String>{}}}
        wire: Group{fields: struct{iban: new Field<String>{}}}
      }
    }
    note: new Hidden<Field<String>>{node: new Field<String>{}}
  }
}

fn orderView(m: OrderModel) -> any View<Scope<Group<OrderModel>.Seen, OrderCtx>>: LayoutView{
  key: "n1"
  parent: none
  widget: Prop.Fixed(
    LayoutWidget.Section(title: "Order", description: none, collapsible: none, labels: none)
  )
  checks: [
    forms.later(
      async fn({data, ctx}): {
        if logic.totalQty(data.items) <= 500 or await approvals.ask(ctx.user.id, logic.totalQty(data.items)):
          none
        else: `The order was not approved`
      }
      fn({data, ctx}): `Waiting for approval of a large order`
    )
  ]
  children: [
    new FieldView{
      key: "n2"
      parent: none
      field: m.country
      widget: Prop.Fixed(FieldWidget.Select(none))
      label: Prop.Fixed("Country")
      checks: [
        forms.answered()
        forms.rule(
          fn({data, ctx}): not logic.isBlocked(data.country)
          fn({data, ctx}): forms.t(
            translations
            ctx.user.lang
            "We don't ship to ${data.country}"
            `We don't ship to ${forms.text(data.country)}`
            [forms.text(data.country)]
          )
        )
      ]
      options: Options.Rows(
        from: forms.awaited(Pending.Form, async fn({data, ctx}): [
          for row in await geo.countries(ctx.params.region): Choice{
            value: (row.id)
            label: (row.name)
          }
        ])
        resolve: forms.awaited(
          Pending.Form
          async fn({data, ctx}): (await geo.countries(ctx.params.region)).some(
            fn(c): c.id == data.country
          )
        )
      )
    }
    new FieldView{
      key: "n3"
      parent: none
      when: Prop.Computed(fn({data, ctx}): data.country != none)
      field: m.city->node
      hide: m.city
      widget: Prop.Fixed(FieldWidget.Select(none))
      label: Prop.Fixed("City")
      checks: [forms.answered()]
      options: Options.Rows(
        from: forms.awaited(Pending.Node, async fn({data, ctx}): [
          for row in await geo.cities(data.country ?? ""): Choice{
            value: (row.id)
            label: (row.name)
          }
        ])
        resolve: forms.awaited(
          Pending.Node
          async fn({data, ctx}): (await geo.cities(data.country ?? "")).some(
            fn(c): c.id == data.city
          )
        )
      )
    }
    new RepeatView{
      key: "n4"
      parent: none
      list: m.items
      widget: Prop.Fixed(RepeatWidget.Table(none))
      label: Prop.Fixed("Items")
      checks: [forms.minItems(Fixed(1))]
      canAdd: true
      item: fn(r1, row1): ScopedView{
        scope: fn(sc): struct{data: sc.data, ctx: sc.ctx, item: r1.seen()}
        view: LayoutView{
          key: `n5@${row1}`
          parent: none
          widget: Prop.Fixed(LayoutWidget.Tablerow)
          children: [
            new FieldView{
              key: `n6@${row1}`
              parent: none
              field: r1.fields.sku
              widget: Prop.Fixed(FieldWidget.Input(none))
              label: Prop.Fixed("SKU")
              checks: [forms.answered(), forms.required(Fixed(true))]
            }
            new FieldView{
              key: `n7@${row1}`
              parent: Prop.Fixed(ParentUi.Tablerow(80))
              field: r1.fields.qty
              widget: Prop.Fixed(FieldWidget.Input(none))
              label: Prop.Fixed("Qty")
              checks: [forms.answered(), forms.min(Fixed(1))]
            }
          ]
        }
      }
    }
    new FieldView{
      key: "n8"
      parent: none
      field: none
      widget: Prop.Fixed(FieldWidget.Input(none))
      label: Prop.Fixed("Total quantity")
      value: Prop.Computed(fn({data, ctx}): logic.totalQty(data.items))
      checks: []
    }
    VariantView{
      key: "n9"
      parent: none
      variant: m.payment
      widget: Prop.Fixed(VariantWidget.Inline)
      label: Prop.Fixed("Payment")
      cases: struct{
        card: CaseView{
          label: Prop.Fixed("Credit card")
          body: ScopedView{
            scope: fn(sc): struct{data: sc.data, ctx: sc.ctx, p: m.payment.cases.card.seen()}
            view: new FieldView{
              key: "n10"
              parent: none
              field: m.payment.cases.card.fields.last4
              widget: Prop.Fixed(FieldWidget.Input(none))
              label: Prop.Fixed("Last 4 digits")
              checks: [forms.answered(), forms.pattern(Fixed("^[0-9]{4}$"))]
            }
          }
        }
        wire: CaseView{
          label: Prop.Fixed("Bank transfer")
          body: ScopedView{
            scope: fn(sc): struct{data: sc.data, ctx: sc.ctx, p: m.payment.cases.wire.seen()}
            view: new FieldView{
              key: "n11"
              parent: none
              field: m.payment.cases.wire.fields.iban
              widget: Prop.Fixed(FieldWidget.Input(none))
              label: Prop.Fixed("IBAN")
              checks: [forms.answered()]
            }
          }
        }
      }
    }
    new FieldView{
      key: "n12"
      parent: none
      when: Prop.Computed(fn({data, ctx}): logic.totalQty(data.items) > 100)
      field: m.note->node
      hide: m.note
      widget: Prop.Computed(
        fn({data, ctx}): FieldWidget.Textarea((if logic.totalQty(data.items) > 1000: 6 else: 3))
      )
      label: Prop.Fixed("Delivery note")
      checks: [forms.answered()]
    }
  ]
}

# ═══════════ The entry point a workflow awaits ═══════════

async fn orderForm(params: OrderParams, user: User, events: Inbox<FormEvent>, views: Inbox<Node>):
  const m = orderModel()
  await forms.run(m, orderView(m.fields), OrderCtx{params, user}, translations, events, views)
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
//   - Anything an expression awaits is resolved by the runtime. `pending` only says how the
//     generated code waits: inline, blocking the form, or in a separate task.
// The end of this file says what each part becomes.

// ═══════════ Expressions and props ═══════════

/** An Istalang expression. In scope where it sits:
 *    data    the form's values, by path; each is none while unanswered or hidden
 *    ctx     ctx.params, ctx.user, and the variables the node's widget provides (ctx.search)
 *    the variables bound by enclosing repeats and variants (`as`)
 *    row     inside options' value and label: the row being mapped
 *    the modules in `imports`: hand-written logic and the sources the host injects.
 *  It may `await`; `pending` says what shows meanwhile. */
type Expr = string;

/** A literal, or an expression. */
type Prop<T> = T | { expr: Expr };

/** Text with ${…} Istalang interpolations. Becomes an Istalang template, and its literal text is
 *  the localization key. \${ is a literal "${". */
type Template = string;

/** How a node's expressions wait, when they await.
 *    form    pasted inline: the whole form waits, and the host shows it busy (the default)
 *    node    each runs in its own task: the node shows loading, and the result arrives as an
 *            event, like a user's edit
 *    hidden  like node, but the node stays hidden until then */
type Pending = "form" | "node" | "hidden";

/** A name: a camelCase identifier. Becomes an Istalang name. */
type Ident = `${Letter}${string}`;
type Letter =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";

/** A value's address: `data` or a bound variable, then field names, joined by ".":
 *  "data.country", "item.qty". A repeat's path names the array; an item that is a single value
 *  (a multiselect's choice) has the bare variable as its path. No indexes, no [], anywhere. */
type Path = `data.${string}` | Ident;

// ═══════════ Field types and constraints ═══════════

type TextFormat = "email" | "uri" | "uuid";
interface Range<V> { min?: Prop<V>; max?: Prop<V> }

/** The field types: the literal a default may be, whether options apply, and the constraints.
 *  Constraint values are props, so a bound can come from data ("max": { "expr": "data.budget" }). */
interface FieldTypes {
  text:     { literal: string;  optionable: true;  constraints: { required?: Prop<boolean>; minLength?: Prop<number>; maxLength?: Prop<number>; pattern?: Prop<string>; format?: TextFormat } };
  number:   { literal: number;  optionable: true;  constraints: Range<number> & { multipleOf?: Prop<number> } };
  integer:  { literal: number;  optionable: true;  constraints: Range<number> & { multipleOf?: Prop<number> } };
  boolean:  { literal: boolean; optionable: false; constraints: {} };
  date:     { literal: string;  optionable: false; constraints: Range<string> };   // ISO date
  datetime: { literal: string;  optionable: false; constraints: Range<string> };   // RFC 3339
  file:     { literal: never;   optionable: false; constraints: { accept?: readonly string[]; maxBytes?: number } };
}
type FieldType = keyof FieldTypes;
type Literal<T extends FieldType> = FieldTypes[T]["literal"];
type OptionableType = { [T in FieldType]: FieldTypes[T]["optionable"] extends true ? T : never }[FieldType];

/** Without `pending`: checked inline, on every render.
 *  With it: a check that waits (an approval). It runs in its own task once the user submits,
 *  and submit waits for it, showing the pending text. */
interface Rule {
  check: Expr;
  message: Template;
  pending?: Template;
}
interface Rules { rules?: readonly Rule[] }
type Constraints<T extends FieldType> = Rules & FieldTypes[T]["constraints"];
interface ItemsConstraints extends Rules { required?: Prop<boolean>; minItems?: Prop<number>; maxItems?: Prop<number> }

// ═══════════ Options ═══════════

interface StaticOptions<T extends OptionableType> {
  items: readonly { value: Literal<T>; label: Prop<string> }[];
}
/** Options from rows: `from` yields them (it may await a source), `value` and `label` map each,
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
type Options<T extends FieldType> = T extends OptionableType ? StaticOptions<T> | RowOptions : never;

// ═══════════ Widgets ═══════════
// The registry is declared by the platform and extended over time. The generator turns it into
// Istalang enums, one per node kind (FieldWidget, RepeatWidget, VariantWidget, LayoutWidget),
// one variant per widget, its ui props as the variant's fields; childUi becomes ParentUi.

type OptionsPolicy = "none" | "required";

interface FieldWidgetTraits {
  ownsLabel?: true;     // draws its own label (a checkbox); parents don't
  provides?: object;    // variables its node's expressions read as ctx.<name> (ctx.search)
  restricted?: true;    // only where a parent's content policy names it
}
interface FieldWidget<T extends FieldType, O extends OptionsPolicy, Ui extends object, X extends FieldWidgetTraits = {}> {
  kind: "field";
  types: T;
  options: O;
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  provides: X extends { provides: infer P } ? P : {};
  placement: X extends { restricted: true } ? "restricted" : "anywhere";
  ui: Ui;
}

/** What a widget holds: "none", "any" node, or only nodes using the named widgets of each kind. */
type ContentPolicy = "none" | "any" | { fields?: string; repeats?: string; layouts?: string };

interface GroupWidgetTraits {
  ownsLabel?: true;
  childUi?: object;     // what it reads from its item's (each case body's) ui.parent
  writesTag?: true;     // variants: a case picker writes the tag
}
interface RepeatWidget<Ui extends object, Item extends ContentPolicy = "any", X extends GroupWidgetTraits = {}> {
  kind: "repeat";
  item: Item;
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  childUi: X extends { childUi: infer U } ? U : {};
  ui: Ui;
}
interface VariantWidget<Ui extends object, X extends GroupWidgetTraits = {}> {
  kind: "variant";
  ownsLabel: X extends { ownsLabel: true } ? true : false;
  writesTag: X extends { writesTag: true } ? true : false;
  childUi: X extends { childUi: infer U } ? U : {};
  ui: Ui;
}
interface LayoutWidgetTraits {
  restricted?: true;
  control?: true;       // draws its raw/choice children as one control (a money input); takes a label
}
interface LayoutWidget<Children extends ContentPolicy, Ui extends object, ChildUi extends object = {}, X extends LayoutWidgetTraits = {}> {
  kind: "layout";
  children: Children;
  childUi: ChildUi;
  placement: X extends { restricted: true } ? "restricted" : "anywhere";
  control: X extends { control: true } ? true : false;
  ui: Ui;
}

type Orientation = { orientation?: "horizontal" | "vertical" };
type Placeholder = { placeholder?: string };
type Labels = { labels?: "top" | "start" | "hidden" };

interface Widgets {
  input:        FieldWidget<"text" | "number" | "integer", "none", Placeholder>;
  textarea:     FieldWidget<"text", "none", { rows?: number }>;
  select:       FieldWidget<OptionableType, "required", Placeholder>;
  autocomplete: FieldWidget<OptionableType, "required", Placeholder, { provides: { search: string } }>;
  radio:        FieldWidget<OptionableType, "required", Orientation>;
  segmented:    FieldWidget<OptionableType, "required", {}>;
  checkbox:     FieldWidget<"boolean", "none", {}, { ownsLabel: true }>;
  toggle:       FieldWidget<"boolean", "none", {}, { ownsLabel: true }>;
  datepicker:   FieldWidget<"date" | "datetime", "none", {}>;
  upload:       FieldWidget<"file", "none", { dropzone?: boolean }>;
  choice:       FieldWidget<OptionableType, "required", {}, { restricted: true }>;
  raw:          FieldWidget<FieldType, "none", {}, { restricted: true }>;
  multiselect:  RepeatWidget<Placeholder, { fields: "choice" }>;
  checkboxes:   RepeatWidget<Orientation, { fields: "choice" }>;
  list:         RepeatWidget<{ addLabel?: string; reorderable?: boolean }>;
  table:        RepeatWidget<{ addLabel?: string }, { layouts: "tablerow" }>;
  cards:        RepeatWidget<{ addLabel?: string; title?: string }>;
  inline:       VariantWidget<{}, { writesTag: true }>;
  panel:        VariantWidget<{ title?: string }>;
  section:      LayoutWidget<"any", { title?: string; description?: string; collapsible?: boolean } & Labels, { span?: 1 | 2 }>;
  labeled:      LayoutWidget<"any", Labels>;
  /** A composite control: an amount and a currency drawn as one input. */
  money:        LayoutWidget<{ fields: "raw" | "choice" }, {}, {}, { control: true }>;
  hstack:       LayoutWidget<"any", { gap?: "sm" | "md" | "lg" } & Labels, { grow?: number }>;
  wizard:       LayoutWidget<{ layouts: "step" }, {}>;
  step:         LayoutWidget<"any", { title: string } & Labels, {}, { restricted: true }>;
  tablerow:     LayoutWidget<{ fields: "input" | "select" | "autocomplete" | "checkbox" | "toggle" | "datepicker"; repeats: "multiselect" },
                             {}, { width?: number }, { restricted: true }>;
  markdown:     LayoutWidget<"none", { markdown: string }>;
  errors:       LayoutWidget<"none", {}>;
  divider:      LayoutWidget<"none", {}>;
}
type WidgetId = keyof Widgets;
type WidgetKind = Widgets[WidgetId]["kind"];
type WidgetsOfKind<K extends WidgetKind> = { [W in WidgetId]: Widgets[W]["kind"] extends K ? W : never }[WidgetId];
type FieldWidgetId = WidgetsOfKind<"field">;
type RepeatWidgetId = WidgetsOfKind<"repeat">;
type VariantWidgetId = WidgetsOfKind<"variant">;
type LayoutWidgetId = WidgetsOfKind<"layout">;
type FreeFieldWidgetId = { [W in FieldWidgetId]: Widgets[W]["placement"] extends "anywhere" ? W : never }[FieldWidgetId];
type FreeLayoutWidgetId = { [W in LayoutWidgetId]: Widgets[W]["placement"] extends "anywhere" ? W : never }[LayoutWidgetId];
type FieldWidgetFor<T extends FieldType> = { [W in FieldWidgetId]: T extends Widgets[W]["types"] ? W : never }[FieldWidgetId];

/** ui: the widget's props, each a Prop, plus `parent`: what the parent widget reads about this
 *  node. Required when any prop is. `parent` is a reserved name. */
type PropsOf<U> = { [K in keyof U]: Prop<Exclude<U[K], undefined>> };
type UiSlot<W extends WidgetId> = {} extends Widgets[W]["ui"]
  ? { ui?: PropsOf<Widgets[W]["ui"]> }
  : { ui: PropsOf<Widgets[W]["ui"]> };
type ParentUiSlot<ChildUi> =
  keyof ChildUi extends never ? {} :
  {} extends ChildUi ? { ui?: { parent?: PropsOf<ChildUi> } } :
  { ui: { parent: PropsOf<ChildUi> } };

// ═══════════ Nodes ═══════════

/** Any node that may stand on its own. Restricted widgets appear only where a parent names them. */
type Node = FieldNodeUsing<FreeFieldWidgetId> | RepeatNode | VariantNode | RefNode | LayoutNode<FreeLayoutWidgetId>;

type Content<P> =
  P extends "any" ? Node :
  | (P extends { fields: infer F extends FieldWidgetId } ? FieldNodeUsing<F> : never)
  | (P extends { repeats: infer R extends RepeatWidgetId } ? RepeatNode<R> : never)
  | (P extends { layouts: infer L extends LayoutWidgetId } ? LayoutNode<L> : never);

interface NodeBase {
  /** A hidden node doesn't exist: not drawn, validated, stored, or seen by expressions.
   *  A `when` sees the values of nodes before it in the tree. */
  when?: Expr;
  pending?: Pending;
}

type Store = "value" | "none" | "snapshot";

// ── field ──
type FieldNodeUsing<F extends FieldWidgetId> = { [T in FieldType]: FieldNode<T, F & FieldWidgetFor<T>> }[FieldType];
type FieldNode<T extends FieldType, W extends FieldWidgetFor<T>> =
  { [K in W]: FieldNodeOf<T, K> }[W];

type FieldNodeOf<T extends FieldType, W extends FieldWidgetFor<T>> = NodeBase & {
  node: "field";
  type: T;
  widget: W;
  label: Prop<string>;
  help?: Prop<string>;
  constraints?: Constraints<T>;
} & FieldData<T, Widgets[W]["options"] extends "none" ? "value" | "none" : Store>
  & UiSlot<W> & OptionsSlot<T, W>;

/** With a path, the value is stored there. Without one, the field only shows `computed`.
 *  default: the initial value; computed: always derived, read-only. */
type FieldData<T extends FieldType, S extends Store> =
  | ({ path: Path; store?: S } & (
      | { default?: Prop<Literal<T>>; computed?: never }
      | { computed: Expr; default?: never }))
  | { path?: never; store?: never; default?: never; computed: Expr };

type OptionsSlot<T extends FieldType, W extends FieldWidgetId> =
  Widgets[W]["options"] extends "required" ? { options: Options<T> } : { options?: never };

// ── repeat ──
type RepeatNode<W extends RepeatWidgetId = RepeatWidgetId> =
  { [K in W]: RepeatNodeOf<K> & UiSlot<K> & RepeatData }[W];

interface RepeatNodeOf<W extends RepeatWidgetId> extends NodeBase {
  node: "repeat";
  path: Path;
  as: Ident;
  widget: W;
  label?: Prop<string>;
  item: Content<Widgets[W]["item"]> & ParentUiSlot<Widgets[W]["childUi"]>;
  /** Identifies rows that come from a default or computed list (`as` in scope), so filled-in
   *  cells follow their row. Rows the user adds are keyed by the instance. */
  rowKey?: Expr;
  /** With a computed default: "rows-edited" stops re-running it once a row is added or
   *  removed; "any-edit" at any change inside. */
  recomputeUntil?: "rows-edited" | "any-edit";
}
type Rows = Prop<readonly object[]>;
type RepeatData = { store?: "value" | "none" } & (
  | { editableCount?: true; default?: Rows; computed?: never; constraints?: ItemsConstraints }
  | { editableCount: false; default: Rows; computed?: never; constraints?: Rules }
  | { computed: Expr; default?: never; editableCount?: never; constraints?: Rules });

// ── variant ──
type VariantNode<W extends VariantWidgetId = VariantWidgetId> =
  { [K in W]: VariantNodeOf<K> & UiSlot<K> & VariantData }[W];

interface VariantNodeOf<W extends VariantWidgetId> extends NodeBase {
  node: "variant";
  path: Path;
  as: Ident;
  widget: W;
  label?: Prop<string>;
  /** The tag's field name inside the variant. Anyone may write it: a picker, or any field. */
  tag: Ident;
  cases: { readonly [id: string]: { label: Prop<string>; body: Node & ParentUiSlot<Widgets[W]["childUi"]> } };
  constraints?: Rules;
}
type VariantData = { store?: "value" | "none" } & (
  | { default?: Prop<string>; computed?: never }   // a case id
  | { computed: Expr; default?: never });

// ── ref ──
/** Mounts a form: a sealed black box. A static ref names a catalog form or a local def and passes
 *  params; a dynamic ref mounts the form an expression yields. */
type RefNode = NodeBase & {
  node: "ref";
  path: Path;
  label?: Prop<string>;
  store?: "value" | "none";
  constraints?: Rules;
} & (
  | { form: FormRef; params?: { readonly [name: string]: Prop<unknown> }; schema?: never }
  | { schema: Expr; form?: never; params?: never });

type FormRef = `catalog:${string}@${string}` | `#${string}`;

// ── layout ──
type LayoutNode<W extends LayoutWidgetId = LayoutWidgetId> =
  { [K in W]: LayoutNodeOf<K> & ChildrenSlot<Widgets[K]["children"], Widgets[K]["childUi"]> & UiSlot<K>
      & (Widgets[K]["control"] extends true ? { label: Prop<string> } : { label?: never }) }[W];

interface LayoutNodeOf<W extends LayoutWidgetId> extends NodeBase {
  node: "layout";
  widget: W;
  constraints?: Rules;
}
type ChildrenSlot<P, ChildUi> = P extends "none" ? { children?: never } : Children<P, ChildUi>;
interface Children<P, ChildUi> { children: readonly (Content<P> & ParentUiSlot<ChildUi>)[] }

// ═══════════ Form document ═══════════

/** A declared type: a field type (with constraints), a literal set, an array, an object,
 *  or any Istalang type by name ({ ista: "geo.Country" }). */
type TypeDecl =
  | FieldType
  | { [T in FieldType]: { type: T } & Constraints<T> }[FieldType]
  | { type: "literal"; values: readonly (string | number | boolean)[] }
  | { type: "array"; items: TypeDecl }
  | { type: "object"; properties: { readonly [name: string]: TypeDecl } }
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

