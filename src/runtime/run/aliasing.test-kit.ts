/**
 * Programs over arrays, maps, structs, closures, `&` paths and copies, each with what it must give
 * by value semantics (§2): a model where every holder keeps a value of its own, so no shared value
 * observably changes. The aliasing property (aliasing.test.ts) compares a run against the model.
 *
 * - **One shape of value:** `Outer` of two `Inner`s, each an array, an array of arrays and a map
 *   keyed by arrays, so a write reaches nested paths, items pushed into collections and map keys.
 * - **Steps are generated blind** and rendered through the model, which skips one it can't run (an
 *   index past the end), so every rendered program runs to its end.
 * - **What it shows:** every variable, snapshot, closure's capture and call result, flattened to
 *   `Int`s by `flat`, so a run's outcome compares as one array.
 */

import fc from 'fast-check';

type Side = 'left' | 'right';

interface Inner {
  items: number[];
  rows: number[][];
  /** Entries in insertion order, keyed by their key's text. */
  tags: Map<string, { readonly key: number[]; value: number }>;
}

interface Outer {
  left: Inner;
  right: Inner;
}

const anySide = fc.constantFrom<Side>('left', 'right');
const anyIndex = fc.nat(7);
const anyItem = fc.integer({ min: 0, max: 99 });

/** The fields a step takes, by its kind; variables and the like are named by index, wrapped. */
const stepFields = {
  copy: { from: anyIndex },
  snapshot: { from: anyIndex },
  closure: { from: anyIndex },
  push: { into: anyIndex, side: anySide, item: anyItem },
  setItem: { into: anyIndex, side: anySide, at: anyIndex, item: anyItem },
  pushRow: { into: anyIndex, side: anySide, from: anyIndex, fromSide: anySide },
  rowPush: { into: anyIndex, side: anySide, at: anyIndex, item: anyItem },
  setTag: { into: anyIndex, side: anySide, from: anyIndex, fromSide: anySide, item: anyItem },
  assignSide: { into: anyIndex, side: anySide, from: anyIndex, fromSide: anySide },
  through: { into: anyIndex, side: anySide, from: anyIndex, item: anyItem },
  spread: { from: anyIndex, side: anySide, into: anyIndex, intoSide: anySide, item: anyItem },
  selfSlice: { into: anyIndex, side: anySide, at: anyIndex },
};

type StepKind = keyof typeof stepFields;

type StepOf<Kind extends StepKind> = { readonly kind: Kind } & {
  readonly [Field in keyof (typeof stepFields)[Kind]]: (typeof stepFields)[Kind][Field] extends fc.Arbitrary<
    infer Each
  >
    ? Each
    : never;
};

/** A step of a case. */
type Step = { [Kind in StepKind]: StepOf<Kind> }[StepKind];

const step = fc.oneof(
  ...Object.entries(stepFields).map(([kind, fields]) =>
    fc.record<Record<string, unknown>>({ kind: fc.constant(kind), ...fields }),
  ),
) as unknown as fc.Arbitrary<Step>;

/** The steps of one case. */
export const caseSteps: fc.Arbitrary<readonly Step[]> = fc.array(step, {
  minLength: 1,
  maxLength: 14,
});

const declarations = `struct Inner:
  items: Array<Int>
  rows: Array<Array<Int>>
  tags: Map<Array<Int>, Int>

struct Outer:
  left: Inner
  right: Inner

fn flatInner(inner: Inner) -> Array<Int>:
  let out = [inner.items.length(), ...inner.items, inner.rows.length()]
  for row in inner.rows:
    out.push(row.length())
    for x in row:
      out.push(x)
  out.push(inner.tags.size())
  for key, value in inner.tags.entries():
    out.push(key.length())
    for x in key:
      out.push(x)
    out.push(value)
  out

fn flat(o: Outer) -> Array<Int>:
  [...flatInner(o.left), ...flatInner(o.right)]

fn through(items: &Array<Int>, outer: Outer, item: Int) -> Array<Int>:
  items.push(item)
  flat(outer)

fn pushed(items: &Array<Int>, item: Int) -> Int:
  items.push(item)
  0
`;

/** A rendered program of `cases`, and the outcome its `main` must give. */
export function aliasingProgram(cases: readonly (readonly Step[])[]): {
  readonly text: string;
  readonly expected: readonly number[];
} {
  // Even cases run on frames, odd ones on the host's stack (codegen.md, "Entries").
  const rendered = cases.map((steps, at) => renderedCase(steps, `case${at}`, at % 2 === 0));
  const awaited = rendered.map((_, at) =>
    at % 2 === 0 ? `  const r${at} = await case${at}()` : `  const r${at} = case${at}()`,
  );
  const shown = rendered.map((_, at) => `...r${at}, -2`).join(', ');
  const text = `import * as runtime from 'runtime'

${declarations}
${rendered.map(({ text: body }) => body).join('\n')}
live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
${awaited.join('\n')}
  [${shown}]
`;
  return { text, expected: rendered.flatMap(({ expected }) => [...expected, -2]) };
}

/**
 * One case as a function `name` of its steps, each run in the model as it is rendered: an async
 * one, or a simple one. A variable no step writes is a `const`, as the checker asks.
 */
function renderedCase(
  steps: readonly Step[],
  name: string,
  async: boolean,
): { readonly text: string; readonly expected: readonly number[] } {
  const model = new CaseModel();
  for (const each of steps) {
    (stepWriters[each.kind] as (model: CaseModel, step: Step) => void)(model, each);
  }
  return {
    text: model.text(async ? `ista async fn ${name}()` : `fn ${name}()`),
    expected: model.shown(),
  };
}

/** A case being rendered: its lines, and the model's values they make. */
class CaseModel {
  readonly variables: Outer[] = [initial()];
  readonly snapshots: Outer[] = [];
  readonly closures: Outer[] = [];
  readonly results: number[][] = [];
  readonly lines = [
    'v0 = Outer{left: Inner{items: [1], rows: [], tags: [:]}, right: Inner{items: [2, 3], rows: [], tags: [:]}}',
  ];
  /** The line declaring each variable. */
  readonly #declaring = [0];
  readonly #written = new Set<number>();

  /** The variable `at` names. */
  variable(at: number): number {
    return at % this.variables.length;
  }

  innerOf(at: number, of: Side): Inner {
    return (this.variables[this.variable(at)] as Outer)[of];
  }

  /** The text of a side of a variable a step writes. */
  written(at: number, of: Side): string {
    this.#written.add(this.variable(at));
    return this.read(at, of);
  }

  /** The text of a side of a variable a step reads. */
  read(at: number, of: Side): string {
    return `v${this.variable(at)}.${of}`;
  }

  /** Declares a new variable holding variable `from`'s value. */
  declare(from: number): void {
    this.#declaring.push(this.lines.length);
    this.lines.push(`v${this.variables.length} = v${this.variable(from)}`);
    this.variables.push(cloned(this.variables[this.variable(from)] as Outer));
  }

  /** The case's code, under `head`. */
  text(head: string): string {
    const lines = [...this.lines];
    this.#declaring.forEach((line, at) => {
      lines[line] = `${this.#written.has(at) ? 'let' : 'const'} ${lines[line]}`;
    });
    const shown = [
      ...this.variables.map((_, at) => `...flat(v${at})`),
      ...this.snapshots.map((_, at) => `...flat(s${at})`),
      ...this.closures.map((_, at) => `...flat(c${at}())`),
      ...this.results.map((_, at) => `...r${at}`),
    ];
    const body = [...lines, `[${shown.join(', ')}]`].map((line) => `  ${line}`).join('\n');
    return `${head} -> Array<Int>:\n${body}\n`;
  }

  /** What the case's code gives. */
  shown(): number[] {
    return [
      ...this.variables.flatMap(flat),
      ...this.snapshots.flatMap(flat),
      ...this.closures.flatMap(flat),
      ...this.results.flat(),
    ];
  }
}

/** How each step is written, and what it does in the model; a step it can't run is left out. */
const stepWriters = {
  copy: (model, { from }) => {
    model.declare(from);
  },
  snapshot: (model, { from }) => {
    model.lines.push(`const s${model.snapshots.length} = v${model.variable(from)}`);
    model.snapshots.push(cloned(model.variables[model.variable(from)] as Outer));
  },
  closure: (model, { from }) => {
    const at = model.closures.length;
    model.lines.push(`const k${at} = v${model.variable(from)}`);
    model.lines.push(`const c${at} = fn() -> Outer: k${at}`);
    model.closures.push(cloned(model.variables[model.variable(from)] as Outer));
  },
  push: (model, { into, side, item }) => {
    model.lines.push(`${model.written(into, side)}.items.push(${item})`);
    model.innerOf(into, side).items.push(item);
  },
  setItem: (model, { into, side, at, item }) => {
    const { items } = model.innerOf(into, side);
    if (at < items.length) {
      model.lines.push(`${model.written(into, side)}.items[${at}] = ${item}`);
      items[at] = item;
    }
  },
  pushRow: (model, { into, side, from, fromSide }) => {
    const row = [...model.innerOf(from, fromSide).items];
    model.lines.push(`${model.written(into, side)}.rows.push(${model.read(from, fromSide)}.items)`);
    model.innerOf(into, side).rows.push(row);
  },
  rowPush: (model, { into, side, at, item }) => {
    const row = model.innerOf(into, side).rows[at];
    if (row !== undefined) {
      model.lines.push(`${model.written(into, side)}.rows[${at}].push(${item})`);
      row.push(item);
    }
  },
  setTag: (model, { into, side, from, fromSide, item }) => {
    const key = [...model.innerOf(from, fromSide).items];
    model.lines.push(
      `${model.written(into, side)}.tags[${model.read(from, fromSide)}.items] = ${item}`,
    );
    const { tags } = model.innerOf(into, side);
    const known = tags.get(key.join(','));
    if (known === undefined) {
      tags.set(key.join(','), { key, value: item });
    } else {
      known.value = item;
    }
  },
  assignSide: (model, { into, side, from, fromSide }) => {
    const value = clonedInner(model.innerOf(from, fromSide));
    model.lines.push(`${model.written(into, side)} = ${model.read(from, fromSide)}`);
    (model.variables[model.variable(into)] as Outer)[side] = value;
  },
  through: (model, { into, side, from, item }) => {
    model.lines.push(
      `const r${model.results.length} = through(&${model.written(into, side)}.items, v${model.variable(from)}, ${item})`,
    );
    model.results.push(flat(model.variables[model.variable(from)] as Outer));
    model.innerOf(into, side).items.push(item);
  },
  spread: (model, { from, side, into, intoSide, item }) => {
    model.lines.push(
      `const r${model.results.length} = [...${model.read(from, side)}.items, pushed(&${model.written(into, intoSide)}.items, ${item})]`,
    );
    model.results.push([...model.innerOf(from, side).items, 0]);
    model.innerOf(into, intoSide).items.push(item);
  },
  selfSlice: (model, { into, side, at }) => {
    const { items } = model.innerOf(into, side);
    if (at < items.length) {
      const path = model.written(into, side);
      model.lines.push(`${path}.items[${at}..${at + 1}] = ${path}.items`);
      items.splice(at, 1, ...items);
    }
  },
} satisfies { readonly [Kind in StepKind]: (model: CaseModel, step: StepOf<Kind>) => void };

function initial(): Outer {
  return {
    left: { items: [1], rows: [], tags: new Map() },
    right: { items: [2, 3], rows: [], tags: new Map() },
  };
}

function clonedInner(inner: Inner): Inner {
  return {
    items: [...inner.items],
    rows: inner.rows.map((row) => [...row]),
    tags: new Map(
      [...inner.tags].map(([text, { key, value }]) => [text, { key: [...key], value }]),
    ),
  };
}

function cloned(outer: Outer): Outer {
  return { left: clonedInner(outer.left), right: clonedInner(outer.right) };
}

function flatInner(inner: Inner): number[] {
  return [
    inner.items.length,
    ...inner.items,
    inner.rows.length,
    ...inner.rows.flatMap((row) => [row.length, ...row]),
    inner.tags.size,
    ...[...inner.tags.values()].flatMap(({ key, value }) => [key.length, ...key, value]),
  ];
}

function flat(outer: Outer): number[] {
  return [...flatInner(outer.left), ...flatInner(outer.right)];
}
