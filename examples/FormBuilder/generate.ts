// generate.ts — turns a form's JSON (form-spec.ts) into its Istalang module.
//
// It never parses an expression. Expressions are pasted into lambdas; the only text handling is
// splitting paths on ".", finding the `await` keyword (to make a lambda async), and finding the
// ${…} spans of a Template (to pass their values to localization).
//
// Output, per form and per local def:
//   a params struct and a ctx struct;
//   a model struct (one node per path) and its factory;
//   scope type aliases (what expressions see inside repeats, variants and refs);
//   a view function building the static view tree, with every expression as a lambda;
//   for the form, an entry point: async fn <id>Form(params, user, events, views) -> Future<Data>.

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

// ═══════════ Small helpers ═══════════

const isExpr = (v: any): v is ExprProp =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof v.expr === 'string' &&
  Object.keys(v).length === 1;
const awaits = (expr: string) => /\bawait\b/u.test(expr);
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
      rendered += `\${forms.text(${expr})}`;
      i = j - 1;
      continue;
    }
    rendered += t[i];
  }
  return { rendered: `\`${rendered}\``, args };
}

const FIELD_TYPES: Record<string, string> = {
  text: 'String',
  number: 'Float',
  integer: 'Int',
  boolean: 'Bool',
  date: 'forms.Date',
  datetime: 'forms.DateTime',
  file: 'forms.FileId',
};

/** A TypeDecl as an Istalang type. */
function declType(d: any): string {
  if (typeof d === 'string') return FIELD_TYPES[d];
  if ('ista' in d) return d.ista;
  if (d.type === 'literal') return d.values.map((x: Json) => lit(x)).join(' | ');
  if (d.type === 'array') return `Array<${declType(d.items)}>`;
  if (d.type === 'object')
    return `{ ${Object.entries(d.properties)
      .map(([k, t]) => `${k}: ${declType(t)}`)
      .join('; ')} }`;
  return FIELD_TYPES[d.type];
}

// ═══════════ The model: one node per path ═══════════

type MNode =
  | { k: 'field'; type: string; literals?: string[]; local: boolean; w: Writers; canon?: string }
  | { k: 'group'; fields: Map<string, MNode> }
  | { k: 'list'; row: MNode | null; w: Writers }
  | { k: 'variant'; tag: string; cases: Map<string, MNode & { k: 'group' }>; w: Writers }
  | { k: 'mount'; type: string; factory: string; w: Writers }
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
    const b = env.get(segs[0]);
    if (!b) throw new Error(`${u.name}: unbound variable "${segs[0]}" in path "${path}"`);
    node = b.node;
    canon = b.canon;
  }
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i],
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
      node.fields.set(s, next!);
    }
    node = next!;
  }
  return { node, canon };
}

/** Pass 1: build the model. Structural nodes first, so a field writing a variant's tag finds the variant. */
function collect(u: Unit, units: Map<string, Unit>, doc: FormDocument) {
  const walk = (
    n: AnyNode,
    env: Map<string, Bound>,
    hideable: boolean,
    phase: 'struct' | 'fields',
  ) => {
    const h = hideable || !!n.when || n.pending === 'hidden';
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
        if (r.parentVariant) return; // writes a variant's tag: the variant owns it
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
        let list: MNode;
        if (phase === 'struct') {
          const r = resolve(u, n.path, env, () => ({ k: 'list', row: null, w: writers() }));
          list = r.node;
          if (list.k !== 'list') throw new Error(`${u.name}: "${n.path}" is not a repeat`);
          list.w.all++;
          if (h) list.w.hideable++;
        } else list = resolve(u, n.path, env).node;
        const l = list as MNode & { k: 'list' };
        // The row: a group, a single field (an item whose path is the variable), or a mounted form.
        const item = n.item as AnyNode;
        if (!l.row) {
          const single = item.node === 'field' && item.path === n.as;
          const mount = item.node === 'ref' && item.path === n.as;
          l.row = single
            ? { k: 'field', type: '', local: false, w: writers() }
            : mount
              ? mountNode(item, units, doc)
              : group();
        }
        const canon = resolve(u, n.path, env).canon;
        const inner = new Map(env).set(n.as, { node: l.row, canon });
        if (l.row.k === 'field') {
          if (phase === 'fields') {
            const asLit = item.type === 'number' ? litFloat : lit;
            const items: string[] | undefined = item.options?.items?.map((it: any) =>
              asLit(it.value),
            );
            l.row.type =
              l.row.type ||
              (item.store === 'snapshot' ? item.options.rowType : FIELD_TYPES[item.type]);
            if (items) l.row.literals = items;
            l.row.canon = canon;
            l.row.w.all++;
          }
        } else if (l.row.k !== 'mount') walk(item, inner, false, phase);
        return;
      }
      case 'variant': {
        let v: MNode;
        if (phase === 'struct') {
          const r = resolve(u, n.path, env, () => ({
            k: 'variant',
            tag: n.tag,
            cases: new Map(),
            w: writers(),
          }));
          v = r.node;
          if (v.k !== 'variant') throw new Error(`${u.name}: "${n.path}" is not a variant`);
          v.w.all++;
          if (h) v.w.hideable++;
          for (const id of Object.keys(n.cases)) if (!v.cases.has(id)) v.cases.set(id, group());
        } else v = resolve(u, n.path, env).node;
        const vv = v as MNode & { k: 'variant' };
        const canon = resolve(u, n.path, env).canon;
        for (const [id, c] of Object.entries<any>(n.cases))
          walk(
            c.body,
            new Map(env).set(n.as, { node: vv.cases.get(id)!, canon: `${canon}.${id}` }),
            false,
            phase,
          );
        return;
      }
      case 'ref': {
        if (phase !== 'struct') return;
        const r = resolve(u, n.path, env, () =>
          n.schema ? { k: 'dynamic', w: writers() } : mountNode(n, units, doc),
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
    return [segs[0] === 'data' ? 'data' : (env.get(segs[0]) ?? segs[0]), ...segs.slice(1)].join(
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

function mountNode(n: AnyNode, _units: Map<string, Unit>, doc: FormDocument): MNode {
  const ref: string = n.form;
  if (ref.startsWith('#')) {
    const d = ref.slice(1);
    if (!doc.defs?.[d]) throw new Error(`unknown def ${ref}`);
    return {
      k: 'mount',
      type: `Group<${pascal(d)}Model>`,
      factory: `${camel(d)}Model()`,
      w: writers(),
    };
  }
  const alias = catalogAlias(ref);
  return { k: 'mount', type: `Group<${alias}.Model>`, factory: `${alias}.model()`, w: writers() };
}
const catalogAlias = (ref: string) => camel(ref.replace(/^catalog:/u, '').replace(/@.*$/u, ''));
const catalogPath = (ref: string) => './catalog/' + ref.replace(/^catalog:/u, '');

/** The Istalang type of a model node; `aliases` gives a name to anonymous row and case types. */
function modelType(u: Unit, n: MNode, canon: string, aliases: string[]): string {
  const wrap = (t: string) => {
    let x = t;
    if (n.k === 'field' && n.local) x = `Local<${x}>`;
    return isHidden(n) ? `Hidden<${x}>` : x;
  };
  switch (n.k) {
    case 'field': {
      const declared = u.def.types?.[n.canon ?? canon];
      const t = declared
        ? declType(declared)
        : n.literals?.length
          ? n.literals.join(' | ')
          : n.type;
      return wrap(`Field<${t}>`);
    }
    case 'group':
      return `Group<${structType(u, n, canon, aliases)}>`;
    case 'list': {
      const rowName = `${pascal(u.name)}${pascal(canon.replace(/^data\./u, ''))}Row`;
      const rowType =
        n.row!.k === 'group'
          ? `Group<${structType(u, n.row!, canon, aliases)}>`
          : modelType(u, n.row!, canon, aliases);
      aliases.push(`type ${rowName} = ${rowType}`);
      return wrap(`List<${rowName}>`);
    }
    case 'variant': {
      const name = `${pascal(u.name)}${pascal(canon.replace(/^data\./u, ''))}Cases`;
      const cases = [...n.cases]
        .map(([id, g]) => `${id}: Group<${structType(u, g, `${canon}.${id}`, aliases)}>`)
        .join('; ');
      aliases.push(`type ${name} = { ${cases} }`);
      return wrap(`Variant<${name}>`);
    }
    case 'mount':
      return wrap(n.type);
    case 'dynamic':
      return wrap('Dynamic');
  }
}
function structType(u: Unit, g: MNode & { k: 'group' }, canon: string, aliases: string[]): string {
  return `{ ${[...g.fields].map(([k, f]) => `${k}: ${modelType(u, f, `${canon}.${k}`, aliases)}`).join('; ')} }`;
}

/** The factory expression creating a model node. */
function factory(u: Unit, n: MNode, canon: string, aliases: string[]): string {
  const t = modelType(u, n, canon, []);
  const wrap = (inner: string, innerType: string) => {
    let x = inner,
      xt = innerType;
    if (n.k === 'field' && n.local) {
      x = `new Local<${xt}>{node: ${x}}`;
      xt = `Local<${xt}>`;
    }
    return isHidden(n) ? `new Hidden<${xt}>{node: ${x}}` : x;
  };
  const unwrapped = t.replace(/^Hidden<(.*)>$/u, '$1').replace(/^Local<(.*)>$/u, '$1');
  switch (n.k) {
    case 'field':
      return wrap(`new ${unwrapped}{}`, unwrapped);
    case 'group':
      return `Group{fields: ${groupLiteral(u, n, canon, aliases)}}`;
    case 'list': {
      const rowName = `${pascal(u.name)}${pascal(canon.replace(/^data\./u, ''))}Row`;
      const row =
        n.row!.k === 'group'
          ? `Group{fields: ${groupLiteral(u, n.row!, canon, aliases)}}`
          : factory(u, n.row!, canon, aliases);
      return wrap(`new List<${rowName}>{make: fn(): ${row}}`, `List<${rowName}>`);
    }
    case 'variant': {
      const tagType = [...n.cases.keys()].map(istaString).join(' | ');
      const cases = [...n.cases]
        .map(([id, g]) => `${id}: Group{fields: ${groupLiteral(u, g, `${canon}.${id}`, aliases)}}`)
        .join(', ');
      const name = `${pascal(u.name)}${pascal(canon.replace(/^data\./u, ''))}Cases`;
      return wrap(
        `Variant{tag: new Field<${tagType}>{}, cases: struct{${cases}}}`,
        `Variant<${name}>`,
      );
    }
    case 'mount':
      return wrap(n.factory, n.type);
    case 'dynamic':
      return wrap('new Dynamic{}', 'Dynamic');
  }
}
function groupLiteral(
  u: Unit,
  g: MNode & { k: 'group' },
  canon: string,
  aliases: string[],
): string {
  return `struct{${[...g.fields].map(([k, f]) => `${k}: ${factory(u, f, `${canon}.${k}`, aliases)}`).join(', ')}}`;
}

// ═══════════ The view ═══════════

/** A scope: its Istalang type name and the variables expressions see in it. */
interface Scope {
  type: string;
  vars: string[];
}
/** Where a variable leads in the model, as an Istalang expression reaching that node. */
interface Access {
  node: MNode;
  expr: string;
  canon: string;
}

class ViewGen {
  scopes: string[] = []; // type aliases for nested scopes
  scopeCount = 0;
  catalogs = new Set<string>();
  u: Unit;
  doc: FormDocument;
  constructor(u: Unit, doc: FormDocument) {
    this.u = u;
    this.doc = doc;
  }

  key(rowKeys: string[]): string {
    const k = `n${++this.u.keyCount}`;
    const prefix = this.u.name === this.doc.id ? '' : '${k}/';
    return rowKeys.length || prefix
      ? `\`${prefix}${k}${rowKeys.map((r) => '@${' + r + '}').join('')}\``
      : istaString(k);
  }

  /** A lambda over the scope. Destructures the scope in a block expression. */
  lam(sc: Scope, body: string, extra: string[] = [], ret?: string): string {
    const params = [`sc: ${sc.type}`, ...extra].join(', ');
    const isAsync = awaits(body);
    const retAnn = ret ? ` -> ${isAsync ? `Future<${ret}>` : ret}` : '';
    const head = isAsync ? `async fn(${params})${retAnn}` : `fn(${params})${retAnn}`;
    const bind = `const struct{${sc.vars.join(', ')}} = sc`;
    return body.includes('\n')
      ? `${head}: {\n    ${bind}\n    ${indent(body, 4)}\n}`
      : `${head}: { ${bind}; ${body} }`;
  }

  /** A Template as an expression yielding the text, localized when the form has a translation. */
  template(t: string): string {
    const { rendered, args } = templateSpans(t);
    if (!this.doc.localization?.[t]) return rendered;
    const textArgs = args.map((a) => `forms.text(${a})`);
    return `forms.t(translations, ctx.user.lang, ${istaString(t)}, ${rendered}, [${textArgs.join(', ')}])`;
  }

  /** A prop: a literal, a lambda, or an awaited lambda with the node's pending behaviour. */
  prop(
    sc: Scope,
    v: AnyProp,
    pending: string,
    asLiteral: (j: Json) => string = lit,
    fixedVariant = 'Prop.Fixed',
  ): string {
    if (isExpr(v)) {
      return awaits(v.expr)
        ? `forms.awaited(${pending}, ${this.lam(sc, v.expr)})`
        : `Prop.Computed{eval: ${this.lam(sc, v.expr)}}`;
    }
    if (typeof v === 'string' && this.doc.localization?.[v])
      return `Prop.Computed{eval: ${this.lam(sc, `forms.t(translations, ctx.user.lang, ${istaString(v)}, ${istaString(v)}, [])`)}}`;
    return `${fixedVariant}{${asLiteral(v as Json)}}`;
  }

  /** The widget with its ui props, as one prop: fixed if every ui prop is, else computed. */
  widget(sc: Scope, id: string, ui: Record<string, AnyProp> = {}, pending: string): string {
    const info = WIDGETS[id];
    if (!info) throw new Error(`unknown widget ${id}`);
    const field = (name: string, v: AnyProp | undefined): string => {
      if (v === undefined) return 'none';
      if (isExpr(v)) return `(${v.expr})`;
      if (typeof v === 'string' && ENUM_PROPS[name]) return `${ENUM_PROPS[name]}.${pascal(v)}`;
      if (typeof v === 'string' && this.doc.localization?.[v])
        return `forms.t(translations, ctx.user.lang, ${istaString(v)}, ${istaString(v)}, [])`;
      return info.ui[name]?.startsWith('Float') ? litFloat(v as Json) : lit(v as Json);
    };
    const props = Object.keys(info.ui);
    const translated = (p: string) =>
      typeof ui[p] === 'string' && !ENUM_PROPS[p] && !!this.doc.localization?.[ui[p] as string];
    const body = props.length
      ? `${info.enumName}.${info.variant}{${props.map((p) => `${p}: ${field(p, ui[p])}`).join(', ')}}`
      : `${info.enumName}.${info.variant}`;
    const computed = props.some((p) => isExpr(ui[p]) || translated(p));
    if (!computed) return `Prop.Fixed{${body}}`;
    return awaits(body)
      ? `forms.awaited(${pending}, ${this.lam(sc, body)})`
      : `Prop.Computed{eval: ${this.lam(sc, body)}}`;
  }

  /** ui.parent: what the parent widget reads about this node. */
  parent(sc: Scope, parentWidget: string | undefined, ui: any, pending: string): string {
    const p = ui?.parent;
    if (!(p && parentWidget)) return 'none';
    const info = WIDGETS[parentWidget];
    const props = Object.keys(info.childUi ?? {});
    const anyExpr = props.some((k) => isExpr(p[k]));
    const asLit = (k: string, val: Json) =>
      info.childUi?.[k]?.startsWith('Float') ? litFloat(val) : lit(val);
    const body = `ParentUi.${info.variant}{${props.map((k) => `${k}: ${p[k] === undefined ? 'none' : isExpr(p[k]) ? `(${p[k].expr})` : asLit(k, p[k])}`).join(', ')}}`;
    if (!anyExpr) return `Prop.Fixed{${body}}`;
    return awaits(body)
      ? `forms.awaited(${pending}, ${this.lam(sc, body)})`
      : `Prop.Computed{eval: ${this.lam(sc, body)}}`;
  }

  pending(n: AnyNode): string {
    return `Pending.${pascal(n.pending ?? 'form')}`;
  }

  /** Resolves a view path to the model, as an Istalang expression for its handle. */
  access(
    path: string,
    env: Map<string, Access>,
    root: string,
  ): { node: MNode; expr: string; tagOf?: string } {
    const segs = path.split('.');
    let cur: Access;
    if (segs[0] === 'data') cur = { node: this.u.model, expr: root, canon: 'data' };
    else {
      const a = env.get(segs[0]);
      if (!a) throw new Error(`unbound ${segs[0]}`);
      cur = a;
    }
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      const node = cur.node;
      if (node.k === 'variant') return { node, expr: `${cur.expr}.tag`, tagOf: cur.expr };
      if (node.k !== 'group') throw new Error(`bad path ${path}`);
      const next = node.fields.get(s)!;
      // a group reached through a variable is a Group value (.fields); the root is the model struct itself
      const base = cur.expr === root ? `${root}.${s}` : `${cur.expr}.fields.${s}`;
      cur = { node: next, expr: base, canon: `${cur.canon}.${s}` };
    }
    return { node: cur.node, expr: cur.expr };
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
        this.pending(n),
        (isFloatField && (k === 'min' || k === 'max')) || k === 'multipleOf' ? litFloat : lit,
        'Fixed',
      );
    if (kind === 'field' && n.path && n.default === undefined && n.computed === undefined)
      out.push('forms.answered()');
    for (const [k, v] of Object.entries<any>(c)) {
      if (k === 'rules') continue;
      if (k === 'format') out.push(`forms.format(Format.${pascal(v)})`);
      else if (k === 'accept') out.push(`forms.accept(${lit(v)})`);
      else if (k === 'maxBytes') out.push(`forms.maxBytes(${lit(v)})`);
      else if (k === 'required')
        out.push(kind === 'items' ? `forms.someItems(${P(v, k)})` : `forms.required(${P(v, k)})`);
      else out.push(`forms.${k}(${P(v, k)})`);
    }
    for (const r of c.rules ?? []) {
      if (r.pending === undefined) {
        out.push(`forms.rule(${this.lam(sc, r.check)}, ${this.lam(sc, this.template(r.message))})`);
      } else {
        out.push(
          `forms.later(\n    ${indent(this.lam(sc, `if ${r.check}: none\nelse: ${this.template(r.message)}`, [], 'String?'), 4)},\n    ${indent(this.lam(sc, this.template(r.pending)), 4)},\n)`,
        );
      }
    }
    return out;
  }

  list(items: string[]): string {
    if (!items.length) return '[]';
    return `[\n    ${items.map((i) => indent(i, 4)).join(',\n    ')},\n]`;
  }

  struct(name: string, fields: [string, string | undefined][]): string {
    const fs = fields.filter(([, v]) => v !== undefined) as [string, string][];
    return `${name}{\n    ${fs.map(([k, v]) => `${k}: ${indent(v, 4)}`).join(',\n    ')},\n}`;
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
    const key = this.key(rowKeys);
    const pend = this.pending(n);
    const common = (): [string, string | undefined][] => [
      ['key', key],
      ['parent', this.parent(sc, parentWidget, n.ui, pend)],
      ['when', n.when ? this.prop(sc, { expr: n.when }, pend) : undefined],
    ];
    switch (n.node) {
      case 'layout': {
        const info = WIDGETS[n.widget];
        const children = (n.children ?? []).map((c: AnyNode) =>
          this.view(c, sc, env, root, rowKeys, n.widget),
        );
        return this.struct(`LayoutView<${sc.type}>`, [
          ...common(),
          ['widget', this.widget(sc, n.widget, n.ui, pend)],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label, pend)],
          ['checks', n.constraints?.rules ? this.list(this.checks(sc, n, 'rules')) : undefined],
          ['children', this.list(children)],
        ]);
        void info;
      }
      case 'field': {
        const target = n.path ? this.access(n.path, env, root) : undefined;
        const node = target?.node;
        const hidden = node && isHidden(node);
        const local = node?.k === 'field' && node.local;
        let field = target?.expr;
        if (field && hidden) field += '->node';
        if (field && local) field += '->node';
        const valueType = this.fieldValueType(n, node);
        const defaultLit = valueType === 'Float' ? litFloat : lit;
        return this.struct(`new FieldView<${sc.type}, ${valueType}>`, [
          ...common(),
          ['field', field ?? 'none'],
          ['hide', hidden ? target!.expr : undefined],
          ['widget', this.widget(sc, n.widget, n.ui, pend)],
          ['label', this.prop(sc, n.label, pend)],
          ['help', n.help === undefined ? undefined : this.prop(sc, n.help, pend)],
          [
            'value',
            n.computed === undefined ? undefined : this.prop(sc, { expr: n.computed }, pend),
          ],
          [
            'default',
            n.default === undefined ? undefined : this.prop(sc, n.default, pend, defaultLit),
          ],
          [
            'checks',
            this.list(this.checks(sc, n, 'field', n.path ? this.canonOf(n.path, env) : undefined)),
          ],
          ['options', n.options ? this.options(sc, n, valueType) : undefined],
        ]);
      }
      case 'repeat': {
        const { node, expr } = this.access(n.path, env, root);
        const l = node as MNode & { k: 'list' };
        const hidden = isHidden(l);
        const rowVar = `row${rowKeys.length + 1}`;
        const r = `r${rowKeys.length + 1}`;
        const rowType = `${pascal(this.u.name)}${pascal(this.canonOf(n.path, env).replace(/^data\./u, ''))}Row`;
        // The row's scope: the outer variables plus this repeat's.
        const inner: Scope = {
          type: this.newScope(sc, n.as, `${rowType}.Seen`),
          vars: [...sc.vars, n.as],
        };
        const innerEnv = new Map(env).set(n.as, {
          node: l.row!,
          expr: r,
          canon: this.canonOf(n.path, env),
        });
        const item: AnyNode = n.item;
        let itemView: string;
        if (l.row!.k === 'mount' && item.node === 'ref')
          itemView = this.mount(item, inner, innerEnv, root, [...rowKeys, rowVar], n.widget, r);
        else itemView = this.view(item, inner, innerEnv, root, [...rowKeys, rowVar], n.widget);
        const scoped = this.struct(`ScopedView<${sc.type}, ${inner.type}>`, [
          [
            'scope',
            `fn(sc): ${inner.type}{${sc.vars.map((v) => `${v}: sc.${v}`).join(', ')}, ${n.as}: ${r}.seen()}`,
          ],
          ['view', itemView],
        ]);
        const editable = n.editableCount !== false && n.computed === undefined;
        return this.struct(`new RepeatView<${sc.type}, ${rowType}>`, [
          ...common(),
          ['list', hidden ? `${expr}->node` : expr],
          ['hide', hidden ? expr : undefined],
          ['widget', this.widget(sc, n.widget, n.ui, pend)],
          ['label', n.label === undefined ? undefined : this.prop(sc, n.label, pend)],
          ['checks', this.list(this.checks(sc, n, editable ? 'items' : 'rules'))],
          ['canAdd', String(editable)],
          [
            'rows',
            n.computed === undefined
              ? n.default === undefined
                ? undefined
                : this.prop(sc, n.default, pend)
              : this.prop(sc, { expr: n.computed }, pend),
          ],
          ['computedRows', n.computed === undefined ? undefined : 'true'],
          [
            'rowKey',
            n.rowKey ? `fn(seen): {\n    const ${n.as} = seen\n    ${n.rowKey}\n}` : undefined,
          ],
          [
            'recomputeUntil',
            n.recomputeUntil ? `Recompute.${pascal(n.recomputeUntil)}` : undefined,
          ],
          ['item', `fn(${r}, ${rowVar}): ${indent(scoped, 0)}`],
        ]);
      }
      case 'variant': {
        const { node, expr } = this.access(n.path, env, root);
        const v = node as MNode & { k: 'variant' };
        const hidden = isHidden(v);
        const vexpr = hidden ? `${expr}->node` : expr;
        const canon = this.canonOf(n.path, env);
        const cases = Object.entries<any>(n.cases).map(([id, c]) => {
          const caseGroup = v.cases.get(id)!;
          const inner: Scope = {
            type: this.newScope(
              sc,
              n.as,
              `${pascal(this.u.name)}${pascal(canon.replace(/^data\./u, ''))}Cases[${istaString(id)}].Seen`,
            ),
            vars: [...sc.vars, n.as],
          };
          const caseExpr = `${vexpr}.cases.${id}`;
          const innerEnv = new Map(env).set(n.as, {
            node: caseGroup,
            expr: caseExpr,
            canon: `${canon}.${id}`,
          });
          const body = this.view(c.body, inner, innerEnv, root, rowKeys, n.widget);
          const scoped = this.struct(`ScopedView<${sc.type}, ${inner.type}>`, [
            [
              'scope',
              `fn(sc): ${inner.type}{${sc.vars.map((x) => `${x}: sc.${x}`).join(', ')}, ${n.as}: ${caseExpr}.seen()}`,
            ],
            ['view', body],
          ]);
          return `${id}: CaseView<${sc.type}>{label: ${this.prop(sc, c.label, pend)}, body: ${indent(scoped, 4)}}`;
        });
        return this.struct(
          `VariantView<${sc.type}, ${pascal(this.u.name)}${pascal(canon.replace(/^data\./u, ''))}Cases>`,
          [
            ...common(),
            ['variant', vexpr],
            ['hide', hidden ? expr : undefined],
            ['widget', this.widget(sc, n.widget, n.ui, pend)],
            ['label', n.label === undefined ? undefined : this.prop(sc, n.label, pend)],
            ['checks', n.constraints?.rules ? this.list(this.checks(sc, n, 'rules')) : undefined],
            ['default', n.default === undefined ? undefined : this.prop(sc, n.default, pend)],
            [
              'tagValue',
              n.computed === undefined ? undefined : this.prop(sc, { expr: n.computed }, pend),
            ],
            ['cases', `struct{\n    ${cases.map((c) => indent(c, 4)).join(',\n    ')},\n}`],
          ],
        );
      }
      case 'ref': {
        const { node, expr } = this.access(n.path, env, root);
        if (n.schema) {
          return this.struct(`new DynamicView<${sc.type}>`, [
            ...common(),
            ['value', isHidden(node) ? `${expr}->node` : expr],
            ['hide', isHidden(node) ? expr : undefined],
            ['label', n.label === undefined ? undefined : this.prop(sc, n.label, pend)],
            ['schema', this.prop(sc, { expr: n.schema }, pend)],
          ]);
        }
        this.u.keyCount--; // the mount's own view numbers its nodes
        return this.mount(
          n,
          sc,
          env,
          root,
          rowKeys,
          parentWidget,
          isHidden(node) ? `${expr}->node` : expr,
          isHidden(node) ? expr : undefined,
        );
      }
    }
    throw new Error(`unknown node ${n.node}`);
  }

  /** A mounted form: its own view, in its own scope built from params. */
  mount(
    n: AnyNode,
    sc: Scope,
    _env: Map<string, Access>,
    _root: string,
    rowKeys: string[],
    parentWidget: string | undefined,
    modelExpr: string,
    hideExpr?: string,
  ): string {
    const key = this.key(rowKeys);
    const pend = this.pending(n);
    const ref: string = n.form;
    let prefix: string, paramsDecl: Record<string, any>;
    if (ref.startsWith('#')) {
      const d = ref.slice(1);
      prefix = camel(d);
      paramsDecl = this.doc.defs![d].params ?? {};
    } else {
      prefix = catalogAlias(ref);
      this.catalogs.add(ref);
      paramsDecl = {};
    }
    const paramsType = ref.startsWith('#') ? `${pascal(ref.slice(1))}Params` : `${prefix}.Params`;
    const ctxType = ref.startsWith('#') ? `${pascal(ref.slice(1))}Ctx` : `${prefix}.Ctx`;
    const scopeType = ref.startsWith('#') ? `${pascal(ref.slice(1))}Scope` : `${prefix}.Scope`;
    const params = Object.entries<any>(n.params ?? {})
      .map(([k, v]) => `${k}: ${isExpr(v) ? `(${v.expr})` : lit(v)}`)
      .join(', ');
    const emptyStruct = ref.startsWith('#') && Object.keys(paramsDecl).length === 0 && !params;
    const paramsVal = emptyStruct ? paramsType : `${paramsType}{${params}}`;
    const viewFn = ref.startsWith('#') ? `${prefix}View` : `${prefix}.view`;
    const scopeFn = this.lam(
      sc,
      `Scope{data: ${modelExpr}.seen(), ctx: ${ctxType}{params: ${paramsVal}, user: ctx.user}}`,
    );
    return this.struct(`ScopedView<${sc.type}, ${scopeType}>`, [
      ['key', key],
      ['parent', this.parent(sc, parentWidget, n.ui, pend)],
      ['when', n.when ? this.prop(sc, { expr: n.when }, pend) : undefined],
      ['hide', hideExpr],
      ['label', n.label === undefined ? undefined : this.prop(sc, n.label, pend)],
      ['scope', scopeFn],
      ['view', `${viewFn}(${modelExpr}.fields, ${key})`],
    ]);
  }

  options(sc: Scope, n: AnyNode, valueType: string): string {
    const o = n.options;
    const pend = this.pending(n);
    if (o.items) {
      const itemLit = valueType === 'Float' ? litFloat : lit;
      const items = o.items.map(
        (it: any) => `Item{value: ${itemLit(it.value)}, label: ${this.prop(sc, it.label, pend)}}`,
      );
      return `Options.Items{items: ${this.list(items)}}`;
    }
    const snapshot = n.store === 'snapshot';
    const choice = `Choice{value: ${snapshot ? 'row' : `(${o.value})`}, label: (${o.label})}`;
    const rowsBody = `[for row in ${o.from}: ${choice}]`;
    const provides = WIDGETS[n.widget].provides ?? [];
    if (provides.includes('search')) {
      // The widget adds ctx.search: widen ctx for this lambda only.
      const body = `const ctx = struct{search, for k, v in ...sc.ctx: [k]: v}\n${sc.vars
        .filter((v) => v !== 'ctx')
        .map((v) => `const ${v} = sc.${v}`)
        .join('\n')}\n${rowsBody}`;
      const head = awaits(body) ? 'async fn(sc, search)' : 'fn(sc, search)';
      return this.struct('Options.Search', [
        ['from', `${head}: {\n    ${indent(body, 4)}\n}`],
        ['resolve', this.prop(sc, { expr: o.resolve }, pend)],
        ['same', `fn(a, b): ${snapshot ? 'a.id == b.id' : 'a == b'}`],
      ]);
    }
    void valueType;
    return this.struct('Options.Rows', [
      ['from', this.prop(sc, { expr: rowsBody }, pend)],
      ['resolve', this.prop(sc, { expr: o.resolve }, pend)],
    ]);
  }

  fieldValueType(n: AnyNode, node?: MNode): string {
    if (node?.k === 'variant') return [...node.cases.keys()].map(istaString).join(' | ');
    if (node?.k === 'field') {
      const t = modelType(this.u, node, '', [])
        .replace(/^Hidden<(.*)>$/u, '$1')
        .replace(/^Local<(.*)>$/u, '$1');
      return t.replace(/^Field<(.*)>$/u, '$1');
    }
    if (n.store === 'snapshot') return n.options.rowType;
    return FIELD_TYPES[n.type];
  }

  canonOf(path: string, env: Map<string, Access>): string {
    const segs = path.split('.');
    const base = segs[0] === 'data' ? 'data' : env.get(segs[0])!.canon;
    return [base, ...segs.slice(1)].join('.');
  }

  newScope(sc: Scope, name: string, type: string): string {
    const t = `${pascal(this.u.name)}Scope${++this.scopeCount}`;
    const outer = sc.vars.map((v) => `${v}: ${this.varType(sc, v)}`);
    this.scopes.push(`type ${t} = { ${[...outer, `${name}: ${type}`].join('; ')} }`);
    this.scopeTypes.set(
      t,
      new Map([...sc.vars.map((v) => [v, this.varType(sc, v)] as [string, string]), [name, type]]),
    );
    return t;
  }
  scopeTypes = new Map<string, Map<string, string>>();
  varType(sc: Scope, v: string): string {
    const known = this.scopeTypes.get(sc.type);
    if (known?.has(v)) return known.get(v)!;
    if (v === 'data') return `Group<${pascal(this.u.name)}Model>.Seen`;
    if (v === 'ctx') return `${pascal(this.u.name)}Ctx`;
    throw new Error(`no type for ${v}`);
  }
}

// ═══════════ The module ═══════════

export function generate(doc: FormDocument, sourceName: string): string {
  const units = new Map<string, Unit>();
  const unitList: Unit[] = [];
  for (const [name, def] of Object.entries(doc.defs ?? {})) {
    const u = new Unit(name, def, doc);
    units.set(name, u);
    unitList.push(u);
  }
  const main = new Unit(doc.id, doc, doc);
  unitList.push(main);
  for (const u of unitList) collect(u, units, doc);

  const out: string[] = [];
  const header = `# ${doc.id}.gen.ista — generated from ${sourceName} ${doc.version}. Do not edit.
#
# The generated part of a form: per form and per local def, a model (one node per path), its
# factory, its scope types, and a view whose expressions are lambdas. forms.run does the rest.
# Expressions are pasted from the schema verbatim.`;
  out.push(header, '');

  const imports = [
    "import Inbox from 'inbox'",
    "import * as forms from './forms'",
    "import Field, Group, List, Variant, Hidden, Local, Dynamic, Scope, Prop, Pending, Check, Recompute from './forms'",
    "import Options, Item, Choice, Format, FieldView, RepeatView, VariantView, CaseView, LayoutView from './forms'",
    "import ScopedView, DynamicView, View, FormEvent, Node, User from './forms'",
    "import FieldWidget, RepeatWidget, VariantWidget, LayoutWidget, ParentUi, LabelStyle, Orientation, Gap from './forms'",
    ...Object.entries(doc.imports ?? {}).map(
      ([alias, path]) => `import * as ${alias} from '${path}'`,
    ),
  ];
  const catalogImportsAt = out.length + 1;
  out.push(imports.join('\n'), '');

  if (doc.localization) {
    const entries = Object.entries(doc.localization).map(
      ([orig, langs]) =>
        `    ${istaString(orig)}: [${Object.entries(langs)
          .map(([l, t]) => `${istaString(l)}: ${istaString(t)}`)
          .join(', ')}],`,
    );
    out.push(
      `const translations: Map<String, Map<String, String>> = [\n${entries.join('\n')}\n]`,
      '',
    );
  } else out.push('const translations: Map<String, Map<String, String>> = [:]', '');

  const catalogs = new Set<string>();
  for (const u of unitList) {
    const P = pascal(u.name),
      c = camel(u.name);
    const aliases: string[] = [];
    const modelFields = [...u.model.fields].map(
      ([k, f]) => `    ${k}: ${modelType(u, f, `data.${k}`, aliases)}`,
    );
    const params = Object.entries<any>(u.def.params ?? {}).map(
      ([k, t]) => `    ${k}: ${declType(t)}`,
    );

    out.push(
      `# ═══════════ ${u === main ? `form "${doc.id}"` : `def "#${u.name}"`} ═══════════`,
      '',
    );
    out.push(params.length ? `struct ${P}Params:\n${params.join('\n')}` : `struct ${P}Params`, '');
    out.push(`struct ${P}Ctx:\n    params: ${P}Params\n    user: User`, '');
    out.push(`struct ${P}Model:\n${modelFields.join('\n')}`, '');
    out.push(...aliases.map((a) => a), '');
    out.push('# Computed, not declared: what submit returns, and what expressions see.');
    out.push(`type ${P}Data = Group<${P}Model>.Data`);
    out.push(`type ${P}Scope = Scope<Group<${P}Model>.Seen, ${P}Ctx>`, '');

    out.push(
      `fn ${c}Model() -> Group<${P}Model>:\n    Group{fields: ${P}Model{\n${[...u.model.fields].map(([k, f]) => `        ${k}: ${factory(u, f, `data.${k}`, [])},`).join('\n')}\n    }}`,
      '',
    );

    const g = new ViewGen(u, doc);
    const root = 'm';
    const body = g.view(
      u.def.root,
      { type: `${P}Scope`, vars: ['data', 'ctx'] },
      new Map(),
      root,
      [],
    );
    g.catalogs.forEach((x) => catalogs.add(x));
    if (g.scopes.length) out.push(...g.scopes, '');
    const sig =
      u === main
        ? `fn ${c}View(m: ${P}Model) -> any View<${P}Scope>:`
        : `fn ${c}View(m: ${P}Model, k: String) -> any View<${P}Scope>:`;
    out.push(`${sig}\n    ${indent(body, 4)}`, '');
  }

  const P = pascal(doc.id),
    c = camel(doc.id);
  out.push('# ═══════════ The entry point a workflow awaits ═══════════', '');
  out.push(
    `async fn ${c}Form(params: ${P}Params, user: User,\n        events: Inbox<FormEvent>, views: Inbox<Node>) -> Future<${P}Data>:\n    const m = ${c}Model()\n    await forms.run(m, ${c}View(m.fields), ${P}Ctx{params, user}, translations, events, views)`,
    '',
  );

  if (catalogs.size) {
    const lines = [...catalogs].map(
      (r) =>
        `import * as ${catalogAlias(r)} from '${catalogPath(r)}'     # exports Model, Params, Ctx, Scope, model(), view()`,
    );
    out.splice(catalogImportsAt, 0, lines.join('\n'));
  }
  return out.join('\n').replace(/\n{3,}/gu, '\n\n');
}

// ═══════════ CLI: node generate.ts form.json > form.gen.ista ═══════════
declare const require: any, process: any, module: any;
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  process.stdout.write(
    generate(JSON.parse(fs.readFileSync(file, 'utf8')), require('path').basename(file)),
  );
}
