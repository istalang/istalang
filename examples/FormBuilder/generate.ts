// generate.ts — turns a form's JSON (form-spec.ts) into its Istalang module.
//
// It never parses an expression. Expressions are pasted into closures; the only text handling is
// splitting paths on ".", finding the ${…} spans of a Template (to pass their values to
// localization), and finding whether an expression names a single-field row's variable, which
// the closure then reads off the row as it runs.
//
// Output, per form and per local def (docs/work/computed/design.md):
//   a params struct and a ctx struct;
//   a model struct (one node per path) and its factory on a graph;
//   what its expressions see: structs whose getters read the model, so every read is tracked;
//   a view function building the view at a place, every expression a closure over that scope;
//   for the form, its opening on a graph of its own and the entry points its hosts start.
// The Istalang formatter lays the text out, so the generated module is canonical.
//
//   node generate.ts order.form.json > order.gen.ista

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { formatText } from 'istalang/formatter';

// ═══════════ The JSON, loosely typed (form-spec.ts has the precise types) ═══════════

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type ExprProp = { expr: string };
type AnyProp = Json | ExprProp;
interface AnyNode {
  node: 'field' | 'repeat' | 'variant' | 'ref' | 'layout';
  [k: string]: any;
}
interface FormDef {
  params?: Record<string, any>;
  types?: Record<string, any>;
  root: AnyNode;
}
interface FormDocument extends FormDef {
  id: string;
  version: string;
  imports?: Record<string, string>;
  defs?: Record<string, FormDef>;
  localization?: Record<string, Record<string, string>>;
}

// ═══════════ The widget registry, as the generator needs it ═══════════
// enum: the Istalang enum; variant: its variant; ui: ui props with their Istalang types;
// provides: context variables the widget adds; childUi: what it reads from ui.parent.

interface WidgetInfo {
  enumName: string;
  variant: string;
  ui: Record<string, string>;
  provides?: string[];
  childUi?: Record<string, string>;
}
const W = (
  enumName: string,
  variant: string,
  ui: Record<string, string> = {},
  extra: Partial<WidgetInfo> = {},
): WidgetInfo => ({ enumName, variant, ui, ...extra });
const LABELS = { labels: 'LabelStyle?' };
const WIDGETS: Record<string, WidgetInfo> = {
  input: W('FieldWidget', 'Input', { placeholder: 'String?' }),
  textarea: W('FieldWidget', 'Textarea', { rows: 'Int?' }),
  select: W('FieldWidget', 'Select', { placeholder: 'String?' }),
  autocomplete: W(
    'FieldWidget',
    'Autocomplete',
    { placeholder: 'String?' },
    { provides: ['search'] },
  ),
  radio: W('FieldWidget', 'Radio', { orientation: 'Orientation?' }),
  segmented: W('FieldWidget', 'Segmented'),
  checkbox: W('FieldWidget', 'Checkbox'),
  toggle: W('FieldWidget', 'Toggle'),
  datepicker: W('FieldWidget', 'Datepicker'),
  upload: W('FieldWidget', 'Upload', { dropzone: 'Bool?' }),
  choice: W('FieldWidget', 'Choice'),
  raw: W('FieldWidget', 'Raw'),
  multiselect: W('RepeatWidget', 'Multiselect', { placeholder: 'String?' }),
  checkboxes: W('RepeatWidget', 'Checkboxes', { orientation: 'Orientation?' }),
  list: W('RepeatWidget', 'List', { addLabel: 'String?', reorderable: 'Bool?' }),
  table: W('RepeatWidget', 'Table', { addLabel: 'String?' }),
  cards: W('RepeatWidget', 'Cards', { addLabel: 'String?', title: 'String?' }),
  inline: W('VariantWidget', 'Inline'),
  panel: W('VariantWidget', 'Panel', { title: 'String?' }),
  section: W(
    'LayoutWidget',
    'Section',
    { title: 'String?', description: 'String?', collapsible: 'Bool?', ...LABELS },
    { childUi: { span: 'Int?' } },
  ),
  labeled: W('LayoutWidget', 'Labeled', { ...LABELS }),
  money: W('LayoutWidget', 'Money'),
  hstack: W('LayoutWidget', 'Hstack', { gap: 'Gap?', ...LABELS }, { childUi: { grow: 'Float?' } }),
  wizard: W('LayoutWidget', 'Wizard'),
  step: W('LayoutWidget', 'Step', { title: 'String', ...LABELS }),
  tablerow: W('LayoutWidget', 'Tablerow', {}, { childUi: { width: 'Int?' } }),
  markdown: W('LayoutWidget', 'Markdown', { markdown: 'String' }),
  errors: W('LayoutWidget', 'Errors'),
  divider: W('LayoutWidget', 'Divider'),
};
// String-valued enum ui props: their JSON value names an enum variant.
const ENUM_PROPS: Record<string, string> = {
  labels: 'LabelStyle',
  orientation: 'Orientation',
  gap: 'Gap',
};

// The runtime's modules, each with the names a generated module may import from it, in the order
// it imports them.
const RUNTIME = [
  { path: './computed', names: ['Graph'] },
  {
    path: './forms/model',
    names: [
      'Field',
      'Group',
      'List',
      'Variant',
      'Hidden',
      'Local',
      'Dynamic',
      'Date',
      'DateTime',
      'FileId',
    ],
  },
  {
    path: './forms/views',
    names: [
      'Place',
      'View',
      'Options',
      'Item',
      'Choice',
      'Recompute',
      'FieldView',
      'RepeatView',
      'VariantView',
      'CaseView',
      'LayoutView',
      'DynamicView',
    ],
  },
  {
    path: './forms/tree',
    names: [
      'FieldWidget',
      'RepeatWidget',
      'VariantWidget',
      'LayoutWidget',
      'ParentUi',
      'LabelStyle',
      'Orientation',
      'Gap',
    ],
  },
  { path: './forms/form', names: ['Form', 'User', 'Problems'] },
];

// ═══════════ Small helpers ═══════════

const isExpr = (v: any): v is ExprProp =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof v.expr === 'string' &&
  Object.keys(v).length === 1;
const pascal = (s: string) =>
  s
    .replace(/(^|[^A-Za-z0-9])([a-z0-9])/gu, (_, __, c) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/gu, '');
const camel = (s: string) => {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};
const indent = (s: string, n: number) =>
  s
    .split('\n')
    .map((l, i) => (i === 0 ? l : ' '.repeat(n) + l))
    .join('\n');
const istaString = (s: string) => JSON.stringify(s);
const article = (word: string) => (/^[aeiou]/iu.test(word) ? 'an' : 'a');
const lastSegment = (path: string) => path.slice(path.lastIndexOf('.') + 1);

/** A variant built by its call: a single field by position, several by name. */
const variantCall = (name: string, fields: [string, string][]): string =>
  fields.length === 1
    ? `${name}(${fields[0]![1]})`
    : `${name}(${fields.map(([k, v]) => `${k}: ${v}`).join(', ')})`;

/** A JSON literal as an Istalang literal. Objects become anonymous structs (`struct{…}`). */
function lit(v: Json): string {
  if (v === null) return 'none';
  if (typeof v === 'string') return istaString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  return `struct{${Object.entries(v)
    .map(([k, x]) => `${k}: ${lit(x)}`)
    .join(', ')}}`;
}

/** A JSON literal where Istalang expects a Float: whole JSON numbers get `.0`. */
function litFloat(v: Json): string {
  if (typeof v === 'number') return Number.isInteger(v) ? `${v}.0` : String(v);
  return lit(v);
}

/** The ${…} spans of a Template, in order (brace-balanced; \${ is literal). */
function templateSpans(t: string): { rendered: string; args: string[] } {
  const args: string[] = [];
  let rendered = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') {
      rendered += t.slice(i, i + 2);
      i++;
      continue;
    }
    if (t[i] === '$' && t[i + 1] === '{') {
      let depth = 1,
        j = i + 2;
      while (j < t.length && depth > 0) {
        if (t[j] === '{') depth++;
        else if (t[j] === '}') depth--;
        j++;
      }
      const expr = t.slice(i + 2, j - 1);
      args.push(expr);
      rendered += `\${checks.text(${expr})}`;
      i = j - 1;
      continue;
    }
    rendered += t[i];
  }
  return { rendered: `\`${rendered}\``, args };
}

// A field type's Istalang type; the model module declares the dates and file ids.
const FIELD_TYPES: Record<string, string> = {
  text: 'String',
  number: 'Float',
  integer: 'Int',
  boolean: 'Bool',
  date: 'Date',
  datetime: 'DateTime',
  file: 'FileId',
};
const MODEL_TYPES = new Set(['Date', 'DateTime', 'FileId']);

/** A TypeDecl as an Istalang type. */
function declType(d: any): string {
  if (typeof d === 'string') return FIELD_TYPES[d]!;
  if ('ista' in d) return d.ista;
  if (d.type === 'literal') return d.values.map((x: Json) => lit(x)).join(' | ');
  if (d.type === 'array') return `Array<${declType(d.items)}>`;
  if (d.type === 'object')
    return `{ ${Object.entries(d.properties)
      .map(([k, t]) => `${k}: ${declType(t)}`)
      .join(', ')} }`;
  return FIELD_TYPES[d.type]!;
}

// ═══════════ The model: one node per path ═══════════

type MNode =
  | { k: 'field'; type: string; literals?: string[]; local: boolean; w: Writers; canon?: string }
  | { k: 'group'; fields: Map<string, MNode> }
  | { k: 'list'; row: MNode | null; w: Writers }
  | {
      k: 'variant';
      tag: string;
      cases: Map<string, MNode & { k: 'group' }>;
      w: Writers;
      tagWritten: boolean;
    }
  | { k: 'mount'; type: string; make: string; def?: string; w: Writers }
  | { k: 'dynamic'; w: Writers };
interface Writers {
  all: number;
  hideable: number;
}
const writers = (): Writers => ({ all: 0, hideable: 0 });
const group = (): MNode & { k: 'group' } => ({ k: 'group', fields: new Map() });

/** A model node is wrapped in Hidden when every writer of it can be hidden by a `when`. */
const isHidden = (n: MNode) => 'w' in n && n.w.all > 0 && n.w.all === n.w.hideable;

interface Bound {
  node: MNode;
  canon: string;
} // what a variable is bound to; its canonical path

class Unit {
  model = group();
  keyCount = 0;
  name: string;
  def: FormDef;
  doc: FormDocument;
  constructor(name: string, def: FormDef, doc: FormDocument) {
    this.name = name;
    this.def = def;
    this.doc = doc;
  }
  get isForm() {
    return this.name === this.doc.id;
  }
}

/** Resolves a path to the model node it names, creating groups (and, via `make`, the last node). */
function resolve(
  u: Unit,
  path: string,
  env: Map<string, Bound>,
  make?: () => MNode,
): { node: MNode; canon: string; parentVariant?: MNode & { k: 'variant' } } {
  const segs = path.split('.');
  let node: MNode, canon: string;
  if (segs[0] === 'data') {
    node = u.model;
    canon = 'data';
  } else {
    const b = env.get(segs[0]!);
    if (!b) throw new Error(`${u.name}: unbound variable "${segs[0]}" in path "${path}"`);
    node = b.node;
    canon = b.canon;
  }
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i]!,
      last = i === segs.length - 1;
    canon += '.' + s;
    if (node.k === 'variant') {
      if (s === node.tag && last) return { node, canon, parentVariant: node };
      throw new Error(
        `${u.name}: "${path}" reaches into variant fields from outside; use its variable`,
      );
    }
    if (node.k !== 'group') throw new Error(`${u.name}: "${path}" goes through a ${node.k}`);
    let next: MNode | undefined = node.fields.get(s);
    if (!next) {
      if (last && make) next = make();
      else if (last) throw new Error(`${u.name}: nothing writes "${path}"`);
      else next = group();
      node.fields.set(s, next);
    }
    node = next;
  }
  return { node, canon };
}

/** Pass 1: build the model. Structural nodes first, so a field writing a variant's tag finds the variant. */
function collect(u: Unit, doc: FormDocument) {
  const walk = (
    n: AnyNode,
    env: Map<string, Bound>,
    hideable: boolean,
    phase: 'struct' | 'fields',
  ) => {
    const h = hideable || !!n.when;
    switch (n.node) {
      case 'layout':
        for (const c of n.children ?? []) walk(c, env, h, phase);
        return;
      case 'field': {
        if (phase !== 'fields' || !n.path) return;
        const asLit = n.type === 'number' ? litFloat : lit;
        const items: string[] | undefined = n.options?.items?.map((it: any) => asLit(it.value));
        const snapshot = n.store === 'snapshot';
        const r = resolve(u, n.path, env, () => ({
          k: 'field',
          type: '',
          local: false,
          w: writers(),
        }));
        if (r.parentVariant) {
          r.parentVariant.tagWritten = true; // the variant owns its tag; this field writes it
          return;
        }
        const f = r.node;
        if (f.k !== 'field') throw new Error(`${u.name}: "${n.path}" is a ${f.k}, not a field`);
        const base = snapshot ? n.options.rowType : FIELD_TYPES[n.type];
        if (snapshot && !n.options?.rowType)
          throw new Error(`${u.name}: "${n.path}" stores a snapshot but has no rowType`);
        f.type = f.type || base;
        if (items && !snapshot)
          f.literals = f.literals ? f.literals.filter((x) => items.includes(x)) : items; // writers intersect
        if (n.store === 'none') f.local = true;
        f.canon = r.canon;
        f.w.all++;
        if (h) f.w.hideable++;
        return;
      }
      case 'repeat': {
        // The structural pass makes the list; the fields pass finds it.
        const make = (): MNode => ({ k: 'list', row: null, w: writers() });
        const { node: list, canon } = resolve(
          u,
          n.path,
          env,
          phase === 'struct' ? make : undefined,
        );
        if (list.k !== 'list') throw new Error(`${u.name}: "${n.path}" is not a repeat`);
        if (phase === 'struct') {
          list.w.all++;
          if (h) list.w.hideable++;
        }
        // The row: a group, a single field (an item whose path is the variable), or a mounted form.
        const item = n.item as AnyNode;
        if (!list.row) {
          const single = item.node === 'field' && item.path === n.as;
          const mount = item.node === 'ref' && item.path === n.as;
          list.row = single
            ? { k: 'field', type: '', local: false, w: writers() }
            : mount
              ? mountNode(item, doc)
              : group();
        }
        const inner = new Map(env).set(n.as, { node: list.row, canon });
        if (list.row.k !== 'mount') walk(item, inner, false, phase);
        return;
      }
      case 'variant': {
        // The structural pass makes the variant and its cases; the fields pass finds them.
        const make = (): MNode => ({
          k: 'variant',
          tag: n.tag,
          cases: new Map(),
          w: writers(),
          tagWritten: false,
        });
        const { node: v, canon } = resolve(u, n.path, env, phase === 'struct' ? make : undefined);
        if (v.k !== 'variant') throw new Error(`${u.name}: "${n.path}" is not a variant`);
        if (phase === 'struct') {
          v.w.all++;
          if (h) v.w.hideable++;
          for (const id of Object.keys(n.cases)) if (!v.cases.has(id)) v.cases.set(id, group());
        }
        for (const [id, c] of Object.entries<any>(n.cases))
          walk(
            c.body,
            new Map(env).set(n.as, { node: v.cases.get(id)!, canon: `${canon}.${id}` }),
            false,
            phase,
          );
        return;
      }
      case 'ref': {
        if (phase !== 'struct') return;
        const r = resolve(u, n.path, env, () =>
          n.schema ? { k: 'dynamic', w: writers() } : mountNode(n, doc),
        );
        const m = r.node;
        if (!('w' in m)) throw new Error(`${u.name}: "${n.path}" is not a mount`);
        m.w.all++;
        if (h) m.w.hideable++;
        return;
      }
    }
  };
  walk(u.def.root, new Map(), false, 'struct');
  walk(u.def.root, new Map(), false, 'fields');
  sortModel(u.model, 'data', documentOrder(u.def.root));
}

/** Every path in the order the schema first mentions it, so the model follows the schema. */
function documentOrder(root: AnyNode): Map<string, number> {
  const order = new Map<string, number>();
  const note = (canon: string) => {
    const segs = canon.split('.');
    for (let i = 2; i <= segs.length; i++) {
      const p = segs.slice(0, i).join('.');
      if (!order.has(p)) order.set(p, order.size);
    }
  };
  const canonOf = (path: string, env: Map<string, string>) => {
    const segs = path.split('.');
    return [segs[0] === 'data' ? 'data' : (env.get(segs[0]!) ?? segs[0]), ...segs.slice(1)].join(
      '.',
    );
  };
  const walk = (n: AnyNode, env: Map<string, string>) => {
    const c = n.path ? canonOf(n.path, env) : undefined;
    if (c) note(c);
    if (n.node === 'layout') for (const ch of n.children ?? []) walk(ch, env);
    if (n.node === 'repeat') walk(n.item, new Map(env).set(n.as, c!));
    if (n.node === 'variant')
      for (const [id, cs] of Object.entries<any>(n.cases))
        walk(cs.body, new Map(env).set(n.as, `${c}.${id}`));
  };
  walk(root, new Map());
  return order;
}
function sortModel(n: MNode, canon: string, order: Map<string, number>) {
  if (n.k === 'group') {
    const entries = [...n.fields].sort(
      ([a], [b]) => (order.get(`${canon}.${a}`) ?? 1e9) - (order.get(`${canon}.${b}`) ?? 1e9),
    );
    n.fields = new Map(entries);
    for (const [k, f] of n.fields) sortModel(f, `${canon}.${k}`, order);
  } else if (n.k === 'list' && n.row) sortModel(n.row, canon, order);
  else if (n.k === 'variant') for (const [id, g] of n.cases) sortModel(g, `${canon}.${id}`, order);
}

function mountNode(n: AnyNode, doc: FormDocument): MNode {
  const ref: string = n.form;
  if (ref.startsWith('#')) {
    const d = ref.slice(1);
    if (!doc.defs?.[d]) throw new Error(`unknown def ${ref}`);
    return {
      k: 'mount',
      type: `Group<${pascal(d)}Model>`,
      make: `${camel(d)}Model`,
      def: d,
      w: writers(),
    };
  }
  const alias = catalogAlias(ref);
  return { k: 'mount', type: `Group<${alias}.Model>`, make: `${alias}.model`, w: writers() };
}
// ── TODO(B92): delete this function, and its two uses, once B92 is fixed ──
// An optional of a recursive def's Seen lowers wrong (tracker B92), its factory's data parameter
// as anywhere, so a recursive def's factory takes no data, and its mounts and rows give it none.
// Its uses: the mount case of `factory`, and the def factory in `unitSection`.
function unseeded(doc: FormDocument): ReadonlySet<string> {
  const mounts = (n: AnyNode): string[] => [
    ...(n.node === 'ref' && typeof n.form === 'string' && n.form.startsWith('#')
      ? [n.form.slice(1)]
      : []),
    ...(n.children ?? []).flatMap(mounts),
    ...(n.item ? mounts(n.item) : []),
    ...Object.values<any>(n.cases ?? {}).flatMap((c) => mounts(c.body)),
  ];
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
    mounts(doc.defs![from]!.root).some(
      (d) => d === to || (!seen.has(d) && reaches(d, to, seen.add(d))),
    );
  return new Set(Object.keys(doc.defs ?? {}).filter((d) => reaches(d, d)));
}

const catalogAlias = (ref: string) => camel(ref.replace(/^catalog:/u, '').replace(/@.*$/u, ''));
const catalogPath = (ref: string) => './catalog/' + ref.replace(/^catalog:/u, '');

// ═══════════ Emitting a module ═══════════

/** What a module uses of the runtime, so it imports that and nothing else. */
class Uses {
  names = new Set<string>();
  checks = false;
  catalogs = new Set<string>();
  name(n: string): string {
    this.names.add(n);
    return n;
  }
}

/** A scope: what its closures read besides the variables in place. */
interface Scope {
  /** A single-field row's variable, read off the row as a closure naming it runs. */
  lazy: ReadonlyMap<string, string>;
}
/** Where a variable leads in the model, as an Istalang expression reaching that node. */
interface Access {
  node: MNode;
  expr: string;
  canon: string;
}

/** Emits one unit: the form or a local def. */
class UnitGen {
  u: Unit;
  doc: FormDocument;
  uses: Uses;
  /** What the unit's expressions see: one struct per scope, in the order the view reaches it. */
  seen: string[] = [];
  constructor(u: Unit, doc: FormDocument, uses: Uses) {
    this.u = u;
    this.doc = doc;
    this.uses = uses;
  }

  get P() {
    return pascal(this.u.name);
  }

  // ── the model ──

  /** A field node's value type: its path's declared type, its writers' literals, or its own. */
  fieldType(n: MNode & { k: 'field' }): string {
    const declared = n.canon === undefined ? undefined : this.u.def.types?.[n.canon];
    const t = declared ? declType(declared) : n.literals?.length ? n.literals.join(' | ') : n.type;
    if (MODEL_TYPES.has(t)) this.uses.name(t);
    return t;
  }

  /** The Istalang type of a model node; `aliases` gives a name to row and case types. */
  modelType(n: MNode, canon: string, aliases: string[] = []): string {
    const wrap = (t: string) => {
      let x = t;
      if (n.k === 'field' && n.local) x = `${this.uses.name('Local')}<${x}>`;
      return isHidden(n) ? `${this.uses.name('Hidden')}<${x}>` : x;
    };
    switch (n.k) {
      case 'field':
        return wrap(`${this.uses.name('Field')}<${this.fieldType(n)}>`);
      case 'group':
        return `Group<${this.structType(n, canon, aliases)}>`;
      case 'list': {
        const rowName = this.rowName(canon);
        const rowType =
          n.row!.k === 'group'
            ? `Group<${this.structType(n.row!, canon, aliases)}>`
            : this.modelType(n.row!, canon, aliases);
        aliases.push(`type ${rowName} = ${rowType}`);
        return wrap(`${this.uses.name('List')}<${rowName}>`);
      }
      case 'variant': {
        const name = this.named(canon, 'Cases');
        const cases = [...n.cases]
          .map(([id, g]) => `${id}: Group<${this.structType(g, `${canon}.${id}`, aliases)}>`)
          .join(', ');
        aliases.push(`type ${name} = { ${cases} }`);
        return wrap(`${this.uses.name('Variant')}<${name}>`);
      }
      case 'mount':
        return wrap(n.type);
      case 'dynamic':
        return wrap(this.uses.name('Dynamic'));
    }
  }
  structType(g: MNode & { k: 'group' }, canon: string, aliases: string[]): string {
    return `{ ${[...g.fields].map(([k, f]) => `${k}: ${this.modelType(f, `${canon}.${k}`, aliases)}`).join(', ')} }`;
  }
  rowName(canon: string): string {
    return this.named(canon, 'Row');
  }
  /** The name of a type generated for the node at `canon`: the unit's, then its path's. */
  named(canon: string, suffix: string): string {
    return `${this.P}${pascal(canon.replace(/^data\./u, ''))}${suffix}`;
  }

  /** The expression making a model node on `graph`, from `data`, what it is made from, if any. */
  factory(n: MNode, canon: string, data?: string): string {
    const from = data === undefined ? '' : `, ${data}`;
    const hide = (x: string) => (isHidden(n) ? `Hidden.make(graph, ${x})` : x);
    switch (n.k) {
      case 'field': {
        const field = `Field.make<${this.fieldType(n)}>(graph${from})`;
        return hide(n.local ? `Local{node: ${field}}` : field);
      }
      case 'group':
        return `Group{fields: ${this.groupLiteral(n, canon, data)}}`;
      case 'list': {
        const row =
          n.row!.k === 'group'
            ? `Group{fields: ${this.groupLiteral(n.row!, canon, 'x')}}`
            : this.factory(n.row!, canon, 'x');
        return hide(
          `List.make(graph, fn(x): ${row}${data === undefined ? '' : `, ${data} ?? []`})`,
        );
      }
      case 'variant': {
        const tagType = [...n.cases.keys()].map(istaString).join(' | ');
        const tagFrom = data === undefined ? '' : `, ${data}?.tag`;
        const cases = [...n.cases]
          .map(
            ([id, g]) =>
              `${id}: Group{fields: ${this.groupLiteral(g, `${canon}.${id}`, data === undefined ? undefined : `${data}?.value.${id}`)}}`,
          )
          .join(', ');
        this.uses.name('Field');
        return hide(
          `Variant{tag: Field.make<${tagType}>(graph${tagFrom}), cases: struct{${cases}}}`,
        );
      }
      case 'mount':
        return hide(
          `${n.make}(graph${n.def !== undefined && unseeded(this.doc).has(n.def) ? '' : from})`,
        );
      case 'dynamic':
        return hide('Dynamic.make(graph)');
    }
  }
  groupLiteral(g: MNode & { k: 'group' }, canon: string, data?: string, name = 'struct'): string {
    return `${name}{${[...g.fields]
      .map(
        ([k, f]) =>
          `${k}: ${this.factory(f, `${canon}.${k}`, data === undefined ? undefined : `${data}?.${k}`)}`,
      )
      .join(', ')}}`;
  }

  // ── what expressions see ──

  /**
   * The struct a scope variable is: getters reading a group's nodes. `holds` is its node's type,
   * the model struct for `data`, a `Group` for any other; a nested group is a struct of its own.
   */
  seenStruct(
    name: string,
    holds: string,
    g: MNode & { k: 'group' },
    canon: string,
    comment: string,
    spelled: string,
  ) {
    const base = holds === `${this.P}Model` ? 'self.m' : 'self.m.fields';
    const nested: (() => void)[] = [];
    const getters = [...g.fields].map(([k, f]) => {
      const at = `${canon}.${k}`;
      if (f.k === 'group') {
        const inner = this.named(at, 'Seen');
        nested.push(() =>
          this.seenStruct(
            inner,
            `Group<${this.structType(f, at, [])}>`,
            f,
            at,
            `What expressions see as \`${spelled}.${k}\`.`,
            `${spelled}.${k}`,
          ),
        );
        return `fn get ${k}(self: ${name}) -> ${inner}: ${inner}{m: ${base}.${k}}`;
      }
      const type =
        f.k === 'field' ? this.optional(this.fieldType(f)) : `${this.modelType(f, at)}.Seen`;
      return `fn get ${k}(self: ${name}) -> ${type}: ${base}.${k}.seen()`;
    });
    this.seen.push(`# ${comment}\nstruct ${name}:\n  m: ${holds}\n\n${getters.join('\n')}`);
    for (const each of nested) each();
  }
  optional(t: string): string {
    return t.includes(' | ') ? `(${t})?` : `${t}?`;
  }

  // ── the view ──

  key(rowKeys: string[]): string {
    const k = `n${++this.u.keyCount}`;
    const prefix = this.u.isForm ? '' : '${k}/';
    return rowKeys.length || prefix
      ? `\`${prefix}${k}${rowKeys.map((r) => '@${' + r + '}').join('')}\``
      : istaString(k);
  }

  /**
   * A closure over the scope giving `body`, after `statements`, reading what it names of a
   * single-field row as it runs.
   */
  close(sc: Scope, body: string, params = '', statements: string[] = []): string {
    const reads = [...sc.lazy]
      .filter(([name]) => new RegExp(`\\b${name}\\b`, 'u').test(body))
      .map(([name, read]) => `const ${name} = ${read}`);
    const before = [...statements, ...reads];
    if (!before.length) return `fn(${params}): ${body}`;
    return `fn(${params}): {\n  ${[...before, indent(body, 2)].join('\n  ')}\n}`;
  }

  /** A string a translation exists for, in the user's language. */
  translated(s: string): string {
    this.uses.checks = true;
    return `checks.t(translations, ctx.user.lang, ${istaString(s)}, ${istaString(s)}, [])`;
  }

  /** A Template as an expression yielding the text, localized when the form has a translation. */
  template(t: string): string {
    const { rendered, args } = templateSpans(t);
    if (args.length) this.uses.checks = true;
    if (!this.doc.localization?.[t]) return rendered;
    this.uses.checks = true;
    const textArgs = args.map((a) => `checks.text(${a})`);
    return `checks.t(translations, ctx.user.lang, ${istaString(t)}, ${rendered}, [${textArgs.join(', ')}])`;
  }

  /** A prop: a closure giving its literal, its translation, or its expression. */
  prop(sc: Scope, v: AnyProp, asLiteral: (j: Json) => string = lit): string {
    if (isExpr(v)) return this.close(sc, v.expr);
    if (typeof v === 'string' && this.doc.localization?.[v]) return `fn(): ${this.translated(v)}`;
    return `fn(): ${asLiteral(v as Json)}`;
  }

  /** The widget with its ui props, as one closure. */
  widget(sc: Scope, id: string, ui: Record<string, AnyProp> = {}): string {
    const info = WIDGETS[id];
    if (!info) throw new Error(`unknown widget ${id}`);
    this.uses.name(info.enumName);
    const field = (name: string, v: AnyProp | undefined): string => {
      if (v === undefined) return 'none';
      if (isExpr(v)) return `(${v.expr})`;
      if (typeof v === 'string' && ENUM_PROPS[name])
        return `${this.uses.name(ENUM_PROPS[name])}.${pascal(v)}`;
      if (typeof v === 'string' && this.doc.localization?.[v]) return this.translated(v);
      return info.ui[name]?.startsWith('Float') ? litFloat(v as Json) : lit(v as Json);
    };
    const props = Object.keys(info.ui);
    const body = props.length
      ? variantCall(
          `${info.enumName}.${info.variant}`,
          props.map((p) => [p, field(p, ui[p])]),
        )
      : `${info.enumName}.${info.variant}`;
    return this.close(sc, body);
  }

  /** ui.parent: what the parent widget reads about this node. */
  parent(sc: Scope, parentWidget: string | undefined, ui: any): string | undefined {
    const p = ui?.parent;
    if (!(p && parentWidget)) return undefined;
    const info = WIDGETS[parentWidget]!;
    const props = Object.keys(info.childUi ?? {});
    const asLit = (k: string, val: Json) =>
      info.childUi?.[k]?.startsWith('Float') ? litFloat(val) : lit(val);
    const body = variantCall(
      `${this.uses.name('ParentUi')}.${info.variant}`,
      props.map((k) => [
        k,
        p[k] === undefined ? 'none' : isExpr(p[k]) ? `(${p[k].expr})` : asLit(k, p[k]),
      ]),
    );
    return this.close(sc, body);
  }

  /** Resolves a view path to the model, as an Istalang expression for its handle. */
  access(path: string, env: Map<string, Access>, root: string): Access {
    const segs = path.split('.');
    let cur: Access;
    if (segs[0] === 'data') cur = { node: this.u.model, expr: root, canon: 'data' };
    else {
      const a = env.get(segs[0]!);
      if (!a) throw new Error(`unbound ${segs[0]}`);
      cur = a;
    }
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i]!;
      const node = cur.node;
      if (node.k === 'variant')
        return { node, expr: `${this.unhidden(node, cur.expr)}.tag`, canon: `${cur.canon}.${s}` };
      if (node.k !== 'group') throw new Error(`bad path ${path}`);
      const next = node.fields.get(s)!;
      // a group reached through a variable is a Group value (.fields); the root is the model struct itself
      const base = cur.expr === root ? `${root}.${s}` : `${cur.expr}.fields.${s}`;
      cur = { node: next, expr: base, canon: `${cur.canon}.${s}` };
    }
    return cur;
  }

  /** The node a Hidden wraps, or the node itself. */
  unhidden(node: MNode, expr: string): string {
    return isHidden(node) ? `${expr}.node` : expr;
  }

  // ── checks ──
  checks(sc: Scope, n: AnyNode, kind: 'field' | 'items' | 'rules', canon?: string): string[] {
    const out: string[] = [];
    // Validation is the union: the node's constraints, plus those its path's `types` entry declares.
    const declared = canon ? this.u.def.types?.[canon] : undefined;
    const fromTypes =
      declared && typeof declared === 'object' && 'type' in declared
        ? Object.fromEntries(Object.entries(declared).filter(([k]) => k !== 'type'))
        : {};
    const c = { ...fromTypes, ...(n.constraints ?? {}) };
    const isFloatField = kind === 'field' && n.type === 'number';
    const P = (v: AnyProp, k: string) =>
      this.prop(
        sc,
        v,
        (isFloatField && (k === 'min' || k === 'max')) || k === 'multipleOf' ? litFloat : lit,
      );
    // A stored field must be answered unless it has a default or a computed value, or is
    // `required`, which says the same of an empty value too.
    if (
      kind === 'field' &&
      n.path &&
      n.default === undefined &&
      n.computed === undefined &&
      c.required !== true
    )
      out.push('checks.answered()');
    for (const [k, v] of Object.entries<any>(c)) {
      if (k === 'rules') continue;
      if (k === 'format') out.push(`checks.format(checks.Format.${pascal(v)})`);
      else if (k === 'accept') out.push(`checks.accept(${lit(v)})`);
      else if (k === 'maxBytes') out.push(`checks.maxBytes(${lit(v)})`);
      else if (k === 'required')
        out.push(kind === 'items' ? `checks.someItems(${P(v, k)})` : `checks.required(${P(v, k)})`);
      else out.push(`checks.${k}(${P(v, k)})`);
    }
    for (const r of c.rules ?? [])
      out.push(
        `checks.rule(${this.close(sc, r.check)}, ${this.close(sc, this.template(r.message))})`,
      );
    if (out.length) this.uses.checks = true;
    return out;
  }

  list(items: string[]): string | undefined {
    if (!items.length) return undefined;
    return `[\n  ${items.map((i) => indent(i, 2)).join(',\n  ')},\n]`;
  }

  /** A view struct built at `at`, its fields one per line. */
  built(name: string, fields: [string, string | undefined][]): string {
    this.uses.name(name);
    const fs = fields.filter(([, v]) => v !== undefined) as [string, string][];
    return `${name}{\n  ${fs.map(([k, v]) => `${k}: ${indent(v, 2)}`).join(',\n  ')},\n}.build(at)`;
  }

  /** The common fields of a view struct: its key, its parent's ui and its `when`. */
  common(
    sc: Scope,
    n: AnyNode,
    key: string,
    parentWidget?: string,
  ): [string, string | undefined][] {
    return [
      ['key', key],
      ['parent', this.parent(sc, parentWidget, n.ui)],
      ['when', n.when ? this.close(sc, n.when) : undefined],
    ];
  }

  // ── nodes ──
  view(
    n: AnyNode,
    sc: Scope,
    env: Map<string, Access>,
    root: string,
    rowKeys: string[],
    parentWidget?: string,
  ): string {
    if (n.node === 'ref' && !n.schema) {
      const { node, expr } = this.access(n.path, env, root);
      return this.mount(
        n,
        sc,
        rowKeys,
        `${this.unhidden(node, expr)}.fields`,
        isHidden(node) ? `${expr}.shown` : undefined,
      );
    }
    const key = this.key(rowKeys);
    switch (n.node) {
      case 'layout': {
        const children = (n.children ?? []).map(
          (c: AnyNode) => `fn(at): ${this.view(c, sc, env, root, rowKeys, n.widget)}`,
        );
        return this.built('LayoutView', [
          ...this.common(sc, n, key, parentWidget),
          ['widget', this.widget(sc, n.widget, n.ui)],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label)],
          ['checks', this.list(this.checks(sc, n, 'rules'))],
          ['children', this.list(children)],
        ]);
      }
      case 'field': {
        const target = n.path ? this.access(n.path, env, root) : undefined;
        const node = target?.node;
        // A field writing a variant's tag holds the tag, which the variant's own hiding covers.
        const writesTag = node?.k === 'variant';
        let field = target && (writesTag ? target.expr : this.unhidden(node!, target.expr));
        if (field && node?.k === 'field' && node.local) field += '.node';
        const valueType = this.fieldValueType(n, node);
        const defaultLit = valueType === 'Float' ? litFloat : lit;
        return this.built('FieldView', [
          ...this.common(sc, n, key, parentWidget),
          ['field', field],
          ['hide', node && !writesTag && isHidden(node) ? `${target!.expr}.shown` : undefined],
          ['widget', this.widget(sc, n.widget, n.ui)],
          ['label', this.prop(sc, n.label)],
          ['help', n.help === undefined ? undefined : this.prop(sc, n.help)],
          ['value', n.computed === undefined ? undefined : this.close(sc, n.computed)],
          ['default', n.default === undefined ? undefined : this.prop(sc, n.default, defaultLit)],
          ['checks', this.list(this.checks(sc, n, 'field', target?.canon))],
          ['options', n.options ? this.options(sc, n, valueType) : undefined],
        ]);
      }
      case 'repeat': {
        const { node, expr, canon } = this.access(n.path, env, root);
        const l = node as MNode & { k: 'list' };
        const depth = rowKeys.length + 1;
        const rowVar = `row${depth}`;
        const r = `r${depth}`;
        const item: AnyNode = n.item;
        const rowKeysIn = [...rowKeys, rowVar];
        let itemFn: string;
        if (l.row!.k === 'mount') {
          itemFn = `fn(${r}, ${rowVar}, at): ${this.mount(item, sc, rowKeysIn, `${r}.fields`)}`;
        } else if (l.row!.k === 'field') {
          const inner: Scope = { lazy: new Map(sc.lazy).set(n.as, `${r}.seen()`) };
          const innerEnv = new Map(env).set(n.as, { node: l.row!, expr: r, canon });
          itemFn = `fn(${r}, ${rowVar}, at): ${this.view(item, inner, innerEnv, root, rowKeysIn, n.widget)}`;
        } else {
          const rowSeen = `${this.rowName(canon)}Seen`;
          this.seenStruct(
            rowSeen,
            this.rowName(canon),
            l.row as MNode & { k: 'group' },
            canon,
            `What ${article(lastSegment(n.path))} \`${lastSegment(n.path)}\` row's expressions see as \`${n.as}\`.`,
            n.as,
          );
          const innerEnv = new Map(env).set(n.as, { node: l.row!, expr: r, canon });
          const body = this.view(item, sc, innerEnv, root, rowKeysIn, n.widget);
          itemFn = `fn(${r}, ${rowVar}, at): {\n  const ${n.as} = ${rowSeen}{m: ${r}}\n  ${indent(body, 2)}\n}`;
        }
        const editable = n.editableCount !== false && n.computed === undefined;
        const rows = n.computed === undefined ? n.default : { expr: n.computed };
        return this.built('RepeatView', [
          ...this.common(sc, n, key, parentWidget),
          ['list', this.unhidden(l, expr)],
          ['hide', isHidden(l) ? `${expr}.shown` : undefined],
          ['widget', this.widget(sc, n.widget, n.ui)],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label)],
          ['checks', this.list(this.checks(sc, n, editable ? 'items' : 'rules'))],
          ['canAdd', String(editable)],
          ['rows', rows === undefined ? undefined : this.prop(sc, rows)],
          ['computedRows', n.computed === undefined ? undefined : 'true'],
          ['rowKey', n.rowKey ? this.close(sc, n.rowKey, n.as) : undefined],
          [
            'recomputeUntil',
            n.recomputeUntil
              ? `${this.uses.name('Recompute')}.${pascal(n.recomputeUntil)}`
              : undefined,
          ],
          ['item', itemFn],
        ]);
      }
      case 'variant': {
        const { node, expr, canon } = this.access(n.path, env, root);
        const v = node as MNode & { k: 'variant' };
        const vexpr = this.unhidden(v, expr);
        const cases = Object.entries<any>(n.cases).map(([id, c]) => {
          const caseGroup = v.cases.get(id)!;
          const caseExpr = `${vexpr}.cases.${id}`;
          const caseSeen = this.named(`${canon}.${id}`, 'Seen');
          this.seenStruct(
            caseSeen,
            `Group<${this.structType(caseGroup, `${canon}.${id}`, [])}>`,
            caseGroup,
            `${canon}.${id}`,
            `What the \`${id}\` case's expressions see as \`${n.as}\`.`,
            n.as,
          );
          const innerEnv = new Map(env).set(n.as, {
            node: caseGroup,
            expr: caseExpr,
            canon: `${canon}.${id}`,
          });
          const body = this.view(c.body, sc, innerEnv, root, rowKeys, n.widget);
          this.uses.name('CaseView');
          return `${id}: CaseView{label: ${this.prop(sc, c.label)}, body: fn(at): {\n  const ${n.as} = ${caseSeen}{m: ${caseExpr}}\n  ${indent(body, 2)}\n}}`;
        });
        // The variant's own picker answers its tag, unless a default, a computed tag or a field does.
        const picker = n.default === undefined && n.computed === undefined && !v.tagWritten;
        const checks = [...(picker ? ['checks.answered()'] : []), ...this.checks(sc, n, 'rules')];
        if (checks.length) this.uses.checks = true;
        return this.built('VariantView', [
          ...this.common(sc, n, key, parentWidget),
          ['variant', vexpr],
          ['hide', isHidden(v) ? `${expr}.shown` : undefined],
          ['widget', this.widget(sc, n.widget, n.ui)],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label)],
          ['checks', this.list(checks)],
          ['default', n.default === undefined ? undefined : this.prop(sc, n.default)],
          ['tag', n.computed === undefined ? undefined : this.close(sc, n.computed)],
          ['cases', `struct{\n  ${cases.map((c) => indent(c, 2)).join(',\n  ')},\n}`],
        ]);
      }
      case 'ref': {
        const { node, expr } = this.access(n.path, env, root);
        return this.built('DynamicView', [
          ...this.common(sc, n, key, parentWidget),
          ['value', this.unhidden(node, expr)],
          ['hide', isHidden(node) ? `${expr}.shown` : undefined],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label)],
          ['schema', this.close(sc, n.schema)],
        ]);
      }
    }
    throw new Error(`unknown node ${n.node}`);
  }

  /**
   * A mounted form: its own view, built at the mount's place with its own scope. Its params are
   * read as its expressions read them, so they track what the mount's expressions read.
   */
  mount(n: AnyNode, sc: Scope, rowKeys: string[], model: string, hide?: string): string {
    const key = this.key(rowKeys);
    const ref: string = n.form;
    const local = ref.startsWith('#');
    const prefix = local ? camel(ref.slice(1)) : catalogAlias(ref);
    if (!local) this.uses.catalogs.add(ref);
    const declared = local ? (this.doc.defs![ref.slice(1)]!.params ?? {}) : {};
    const paramsType = local ? `${pascal(ref.slice(1))}Params` : `${prefix}.Params`;
    const ctxType = local ? `${pascal(ref.slice(1))}Ctx` : `${prefix}.Ctx`;
    const params = Object.entries<any>(n.params ?? {})
      .map(([k, v]) => `${k}: ${isExpr(v) ? `(${v.expr})` : lit(v)}`)
      .join(', ');
    const paramsVal =
      local && Object.keys(declared).length === 0 && !params
        ? paramsType
        : `${paramsType}{${params}}`;
    const viewFn = local ? `${prefix}View` : `${prefix}.view`;
    const at =
      n.when || hide
        ? `at.within(${n.when ? this.close(sc, n.when) : 'none'}, ${hide ?? 'none'})`
        : 'at';
    return `${viewFn}(${at}, ${model}, ${ctxType}{user: ctx.user, paramsFrom: ${this.close(sc, paramsVal)}}, ${key})`;
  }

  options(sc: Scope, n: AnyNode, valueType: string): string {
    const o = n.options;
    if (o.items) {
      const itemLit = valueType === 'Float' ? litFloat : lit;
      this.uses.name('Item');
      const items = o.items.map(
        (it: any) => `Item{value: ${itemLit(it.value)}, label: ${this.prop(sc, it.label)}}`,
      );
      return `${this.uses.name('Options')}.Items(${this.list(items) ?? '[]'})`;
    }
    const snapshot = n.store === 'snapshot';
    const choice = `${this.uses.name('Choice')}{value: ${snapshot ? 'row' : `(${o.value})`}, label: (${o.label})}`;
    const rows = `[for row in ${o.from}: ${choice}]`;
    const resolve = this.close(sc, o.resolve);
    this.uses.name('Options');
    if ((WIDGETS[n.widget]!.provides ?? []).includes('search')) {
      // The widget adds ctx.search, the typed text `from` takes.
      const widened = 'const ctx = struct{search, params: ctx.params, user: ctx.user}';
      return `Options.Search(from: ${this.close(sc, rows, 'search', [widened])}, resolve: ${resolve})`;
    }
    return `Options.Rows(from: ${this.close(sc, rows)}, resolve: ${resolve})`;
  }

  fieldValueType(n: AnyNode, node?: MNode): string {
    if (node?.k === 'variant') return [...node.cases.keys()].map(istaString).join(' | ');
    if (node?.k === 'field') return this.fieldType(node);
    if (n.store === 'snapshot') return n.options.rowType;
    return FIELD_TYPES[n.type]!;
  }
}

// ═══════════ The module ═══════════

export function generate(doc: FormDocument, sourceName: string): string {
  const units: Unit[] = Object.entries(doc.defs ?? {}).map(
    ([name, def]) => new Unit(name, def, doc),
  );
  const main = new Unit(doc.id, doc, doc);
  units.push(main);
  for (const u of units) collect(u, doc);

  const uses = new Uses();
  for (const always of ['Graph', 'Group', 'User', 'Place', 'View']) uses.name(always);
  const sections = units.map((u) => unitSection(u, doc, uses));
  sections.push(entries(main));

  const runtime = ({ path, names }: { path: string; names: string[] }) => {
    const used = names.filter((n) => uses.names.has(n));
    return used.length ? [`import ${used.join(', ')} from '${path}'`] : [];
  };
  const [computed, ...forms] = RUNTIME;
  const imports = [
    ...runtime(computed!),
    ...(uses.checks ? ["import * as checks from './forms/checks'"] : []),
    ...forms.flatMap(runtime),
    ...Object.entries(doc.imports ?? {}).map(
      ([alias, path]) => `import * as ${alias} from '${path}'`,
    ),
    ...[...uses.catalogs].map((r) => `import * as ${catalogAlias(r)} from '${catalogPath(r)}'`),
  ];

  const translations = doc.localization
    ? `const translations: Map<String, Map<String, String>> = [\n${Object.entries(doc.localization)
        .map(
          ([orig, langs]) =>
            `  ${istaString(orig)}: [${Object.entries(langs)
              .map(([l, t]) => `${istaString(l)}: ${istaString(t)}`)
              .join(', ')}],`,
        )
        .join('\n')}\n]`
    : undefined;

  const header = `# ${doc.id}.gen.ista — generated from ${sourceName} ${doc.version}. Do not edit.
#
# The generated part of a form: per form and per local def, a model (one node per path), its
# factory, what its expressions see (structs whose getters read the model, so every read is
# tracked), and a view whose expressions are closures over that scope. forms/ does the rest.
# Expressions are pasted from the schema verbatim.`;
  const text = [header, imports.join('\n'), translations, ...sections]
    .filter((part) => part !== undefined)
    .join('\n\n');
  const formatted = formatText(`${text}\n`);
  if (formatted === undefined)
    throw new Error(`the module generated from ${sourceName} doesn't parse`);
  return formatted;
}

/** A unit's declarations: params, ctx, model and factory, what its expressions see, its view. */
function unitSection(u: Unit, doc: FormDocument, uses: Uses): string {
  const g = new UnitGen(u, doc, uses);
  const P = pascal(u.name),
    c = camel(u.name);
  const aliases: string[] = [];
  const modelFields = [...u.model.fields].map(
    ([k, f]) => `  ${k}: ${g.modelType(f, `data.${k}`, aliases)}`,
  );
  const params = Object.entries<any>(u.def.params ?? {}).map(([k, t]) => `  ${k}: ${declType(t)}`);
  const ctx = u.isForm
    ? `struct ${P}Ctx:\n  params: ${P}Params\n  user: User`
    : `struct ${P}Ctx:\n  user: User\n  paramsFrom: inert fn() -> ${P}Params\n\n` +
      `# Its params as its mount gives them, read when an expression reads them.\n` +
      `fn get params(self: ${P}Ctx) -> ${P}Params: (self.paramsFrom)()`;
  const factory =
    u.isForm || unseeded(doc).has(u.name)
      ? `fn ${c}Model(graph: Graph) -> Group<${P}Model>: Group{fields: ${g.groupLiteral(u.model, 'data', undefined, `${P}Model`)}}`
      : `fn ${c}Model(graph: Graph, x: Group<${P}Model>.Seen? = none) -> Group<${P}Model>: Group{fields: ${g.groupLiteral(u.model, 'data', 'x', `${P}Model`)}}`;

  g.seenStruct(
    `${P}Seen`,
    `${P}Model`,
    u.model,
    'data',
    `What the ${u.isForm ? 'form' : 'def'}'s expressions see as \`data\`.`,
    'data',
  );
  const body = g.view(u.def.root, { lazy: new Map() }, new Map(), 'm', []);
  const sig = u.isForm
    ? `fn ${c}View(at: Place, m: ${P}Model, ctx: ${P}Ctx) -> View:`
    : `fn ${c}View(at: Place, m: ${P}Model, ctx: ${P}Ctx, k: String) -> View:`;
  const view = `${sig}\n  const data = ${P}Seen{m}\n  ${indent(body, 2)}`;

  const parts = [
    `# ═══════════ ${u.isForm ? `form "${doc.id}"` : `def "#${u.name}"`} ═══════════`,
    params.length ? `struct ${P}Params:\n${params.join('\n')}` : `struct ${P}Params`,
    ctx,
    `struct ${P}Model:\n${modelFields.join('\n')}`,
    aliases.length ? aliases.join('\n') : undefined,
    factory,
    ...g.seen,
    view,
  ];
  if (u.isForm) {
    uses.name('Form');
    uses.name('Problems');
    parts.push(
      `# The form on a graph of its own.\nfn open${P}(params: ${P}Params, user: User) -> Form<${P}Model>:\n  const graph = new Graph{}\n  const model = ${c}Model(graph)\n  Form.open(graph, model, fn(at): ${c}View(at, model.fields, ${P}Ctx{params, user}))`,
    );
  }
  return parts.filter((part) => part !== undefined).join('\n\n');
}

/** The form's entry points: the browser's and the backend's live functions. */
function entries(main: Unit): string {
  const P = pascal(main.name),
    c = camel(main.name);
  return [
    '# ═══════════ The entry points its hosts start ═══════════',
    `# The browser's: serves the form until a valid submit, and gives the value to submit.\nlive async fn ${c}Form(params: ${P}Params, user: User) -> Group<${P}Model>.Seen:\n  await open${P}(params, user).serve()`,
    `# The backend's: validates a whole value.\nlive fn validate${P}(params: ${P}Params, user: User, value: Group<${P}Model>.Seen) -> Result<Group<${P}Model>.Data, Problems>:\n  open${P}(params, user).validate(value)`,
  ].join('\n\n');
}

// ═══════════ CLI: node generate.ts form.json > form.gen.ista ═══════════

if (process.argv[1] === import.meta.filename) {
  const file = process.argv[2];
  if (file === undefined) throw new Error('usage: node generate.ts <form>.json');
  process.stdout.write(generate(JSON.parse(readFileSync(file, 'utf8')), basename(file)));
}
