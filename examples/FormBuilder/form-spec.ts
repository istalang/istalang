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
