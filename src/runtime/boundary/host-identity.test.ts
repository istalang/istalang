/**
 * A value given to a host again, unchanged, is the same JavaScript object, at every depth, and
 * everything a host gets is frozen (§9; definition/values/written-json.ts, json-values.ts `plainOfJson`):
 * on programs the real compiler builds, seen by the host extern `main.show`.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { ManualClock } from '../clock.ts';
import { startLive } from '../program.ts';
import { startToEnd, testRuntime, testSeed } from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

/** A program's declarations, and the key of its extern `show(value: …)`, as its host binds it. */
interface Showing {
  readonly declarations: readonly string[];
  readonly key: string;
}

/** What `show` got at each call, `_main`'s `body` running in an instance. */
async function shown({ declarations, key }: Showing, body: readonly string[]): Promise<unknown[]> {
  const program = compiledText(
    [
      "import Json from 'json'\nimport * as json from 'json'\nimport * as runtime from 'runtime'",
      ...declarations,
      'live async fn main(): await runtime.run(runtime.id()) _main()',
      'ista async fn _main():',
      ...body.map((line) => `  ${line}`),
    ].join('\n'),
  );
  const seen: unknown[] = [];
  const host: HostExterns = {
    [key]: ([value]) => {
      seen.push(value);
      return null;
    },
  };
  const outcome = await startToEnd(testRuntime({ host }), program, { instance: 'i' });
  if (outcome.kind !== 'finished') {
    throw new Error(`The program didn't finish: ${JSON.stringify(outcome)}`);
  }
  return seen;
}

/** The part of `plain`, a host's JavaScript, at `path`: object keys and array indexes. */
function at(plain: unknown, ...path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>(
    (part, step) => (part as Record<string | number, unknown> | undefined)?.[step],
    plain,
  );
}

const trees: Showing = {
  declarations: [
    'struct Item { name: String }',
    'struct Tree { total: Int, items: Array<Item>, fixed: Array<Int> }',
    'extern fn show(tree: Tree)',
  ],
  key: 'main.show(main.Tree)',
};

describe('a value given to a host again', () => {
  it('is the same object when kept, at the top and at every depth', async () => {
    const [first, second] = await shown(trees, [
      'const kept = Tree{total: 1, items: [Item{name: "a"}], fixed: [1, 2]}',
      'show(kept)',
      'show(kept)',
    ]);
    expect(second).toBe(first);
    expect(at(second, 'items', 0)).toBe(at(first, 'items', 0));
  });

  it('keeps the parts kept when the whole is rebuilt around them', async () => {
    const [first, second] = await shown(trees, [
      'const fixed = [1, 2, 3]',
      'const items = [Item{name: "a"}]',
      'show(Tree{total: 1, items, fixed})',
      'show(Tree{total: 2, items, fixed})',
    ]);
    expect(second).not.toBe(first);
    expect(at(second, 'fixed')).toBe(at(first, 'fixed'));
    expect(at(second, 'items')).toBe(at(first, 'items'));
  });

  it('is a new object when rebuilt equal', async () => {
    const [first, second] = await shown(trees, [
      'show(Tree{total: 1, items: [], fixed: [1]})',
      'show(Tree{total: 1, items: [], fixed: [1]})',
    ]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(at(second, 'fixed')).not.toBe(at(first, 'fixed'));
  });

  it('keeps the unchanged elements of an array changed in place, the array new', async () => {
    const [first, second, third, fourth, fifth] = await shown(trees, [
      'let items = [Item{name: "a"}, Item{name: "b"}]',
      'const fixed: Array<Int> = []',
      'show(Tree{total: 0, items, fixed})',
      'items.push(Item{name: "c"})',
      'show(Tree{total: 0, items, fixed})',
      'items[1] = Item{name: "B"}',
      'show(Tree{total: 0, items, fixed})',
      'items[1..2] = [Item{name: "b2"}, Item{name: "b3"}]',
      'show(Tree{total: 0, items, fixed})',
      'items.reverse()',
      'show(Tree{total: 0, items, fixed})',
    ]);
    expect(at(second, 'items')).not.toBe(at(first, 'items'));
    expect(at(second, 'items', 0)).toBe(at(first, 'items', 0));
    expect(at(second, 'items', 1)).toBe(at(first, 'items', 1));
    expect(at(third, 'items')).not.toBe(at(second, 'items'));
    expect(at(third, 'items', 0)).toBe(at(first, 'items', 0));
    expect(at(third, 'items', 1)).toEqual({ name: 'B' });
    expect(at(third, 'items', 2)).toBe(at(second, 'items', 2));
    expect(at(fourth, 'items')).not.toBe(at(third, 'items'));
    expect(at(fourth, 'items', 0)).toBe(at(first, 'items', 0));
    expect(at(fourth, 'items', 3)).toBe(at(second, 'items', 2));
    expect(at(fifth, 'items')).not.toBe(at(fourth, 'items'));
    expect(at(fifth, 'items', 0)).toBe(at(second, 'items', 2));
    expect(at(fifth, 'items', 3)).toBe(at(first, 'items', 0));
  });

  it('is new for a field changed in place, and so is every value holding it', async () => {
    const roots: Showing = {
      declarations: [
        'struct Leaf { n: Int }',
        'struct Branch { leaf: Leaf, other: Leaf }',
        'struct Root { branch: Branch, side: Array<Int> }',
        'extern fn show(root: Root)',
      ],
      key: 'main.show(main.Root)',
    };
    const [first, second] = await shown(roots, [
      'let root = Root{branch: Branch{leaf: Leaf{n: 1}, other: Leaf{n: 2}}, side: [1]}',
      'show(root)',
      'root.branch.leaf.n = 5',
      'show(root)',
    ]);
    expect(second).not.toBe(first);
    expect(at(second, 'branch')).not.toBe(at(first, 'branch'));
    expect(at(second, 'branch', 'leaf')).toEqual({ n: 5n });
    expect(at(second, 'branch', 'other')).toBe(at(first, 'branch', 'other'));
    expect(at(second, 'side')).toBe(at(first, 'side'));
  });

  it('is new for a map changed in place by setting or deleting an entry', async () => {
    const maps: Showing = {
      declarations: ['extern fn show(map: Map<String, Array<Int>>)'],
      key: 'main.show(prelude.Map<String, prelude.Array<Int>>)',
    };
    const [first, second, third] = await shown(maps, [
      'let map = ["a": [1], "b": [2]]',
      'show(map)',
      'map["c"] = [3]',
      'show(map)',
      'drop map.delete("c")',
      'show(map)',
    ]);
    expect(second).not.toBe(first);
    expect(at(second, 'a')).toBe(at(first, 'a'));
    expect(third).not.toBe(second);
    expect(third).toEqual(first);
    expect(at(third, 'b')).toBe(at(first, 'b'));
  });

  it('is unchanged when code changes the JSON it was written as', async () => {
    const items: Showing = {
      declarations: ['struct Item { name: String }', 'extern fn show(item: Item)'],
      key: 'main.show(main.Item)',
    };
    const [first, second] = await shown(items, [
      'const item = Item{name: "a"}',
      'show(item)',
      'let fields: Map<String, Json> = [:]',
      'match json.encode(item):',
      '  case Map<String, Json> as found: fields = found',
      '  case _: fields = [:]',
      'fields["name"] = "b"',
      'show(item)',
    ]);
    expect(second).toEqual({ name: 'a' });
    expect(second).toBe(first);
  });

  it('is the same object for a kept array or map of Json given as Json', async () => {
    const jsons: Showing = {
      declarations: ['extern fn show(json: Json)'],
      key: 'main.show(json.Json)',
    };
    const [firstArray, secondArray, firstMap, secondMap] = await shown(jsons, [
      'const items: Array<Json> = [1, "two", [3]]',
      'const fields: Map<String, Json> = ["a": 1, "b": [2]]',
      'show(items)',
      'show(items)',
      'show(fields)',
      'show(fields)',
    ]);
    expect(secondArray).toBe(firstArray);
    expect(secondMap).toBe(firstMap);
  });

  it('is the same object when given to an extern and returned in the outcome, its codec running once', async () => {
    const program = compiledText(
      [
        "import Json from 'json'",
        'struct Item { name: String }',
        'struct Tree { total: Int, items: Array<Item>, fixed: Array<Int> }',
        'extern fn note()',
        'fn toJson(self: Item) -> Json:',
        '  note()',
        '  ["name": self.name]',
        'extern fn show(tree: Tree)',
        'live async fn main() -> (Tree, Item):',
        '  const item = Item{name: "a"}',
        '  const kept = Tree{total: 1, items: [item], fixed: [1, 2]}',
        '  show(kept)',
        '  (kept, item)',
      ].join('\n'),
    );
    const seen: unknown[] = [];
    let encodedItems = 0;
    const host: HostExterns = {
      'main.note()': () => {
        encodedItems += 1;
        return null;
      },
      'main.show(main.Tree)': ([value]) => {
        seen.push(value);
        return null;
      },
    };
    const binding = {
      natives: stdNatives,
      externs: host,
      clock: new ManualClock(),
      seed: testSeed,
    };
    const { end } = await startLive(definitionFormat.read(program), binding);
    if (end.kind !== 'finished') {
      throw new Error(`The program didn't finish: ${JSON.stringify(end)}`);
    }
    const { outcome } = end;
    expect(at(outcome, 0)).toBe(seen[0]);
    expect(at(outcome, 1)).toBe(at(seen[0], 'items', 0));
    expect(encodedItems).toBe(1);
  });

  it('is the same object for a disposable host value kept, dereferenced from a WeakRef, and disposed', async () => {
    const program = compiledText(
      [
        "import * as runtime from 'runtime'",
        'extern shared struct Lease',
        'extern fn open() -> Lease',
        'extern fn show(leases: Array<Lease>, found: Lease?)',
        'extern fn release(lease: Lease)',
        'fn dispose(self: Lease): release(self)',
        'live async fn main(): await runtime.run(runtime.id()) _main()',
        'ista async fn _main():',
        '  const lease = open()',
        '  const weak = WeakRef(lease)',
        '  const leases = [lease]',
        '  show(leases, lease)',
        '  show(leases, weak.deref())',
      ].join('\n'),
    );
    const seen: unknown[] = [];
    const released: unknown[] = [];
    const host: HostExterns = {
      'main.open()': () => ({ id: 'a', parts: [1, 2] }),
      'main.show(prelude.Array<main.Lease>, prelude.Optional<main.Lease>)': ([leases, found]) => {
        seen.push([leases, found]);
        return null;
      },
      'main.release(main.Lease)': ([lease]) => {
        released.push(lease);
        return null;
      },
    };
    await startToEnd(testRuntime({ host }), program, { instance: 'i' });
    expect(at(seen[1], 0)).toBe(at(seen[0], 0));
    expect(at(seen[0], 1)).toBe(at(seen[0], 0, 0));
    expect(at(seen[1], 1)).toBe(at(seen[0], 1));
    expect(released[0]).toBe(at(seen[0], 1));
  });

  it('is frozen at every depth', async () => {
    const [given] = await shown(trees, [
      'show(Tree{total: 1, items: [Item{name: "a"}], fixed: [1]})',
    ]);
    for (const part of [given, at(given, 'items'), at(given, 'items', 0), at(given, 'fixed')]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });
});

describe('one object given as two types', () => {
  it('is written by each type its own codec', async () => {
    const boxes: Showing = {
      declarations: [
        'struct Box<T> { value: T }',
        'fn toJson(self: Box<"a">) -> Json: "as a literal"',
        'fn toJson(self: Box<String>) -> Json: "as a string"',
        'extern fn show(boxes: (Box<"a">, Box<String>))',
      ],
      key: 'main.show((main.Box<"a">, main.Box<String>))',
    };
    const seen = await shown(boxes, [
      'const box: Box<"a"> = Box{value: "a"}',
      'show((box, box))',
      'show((box, box))',
    ]);
    expect(seen).toEqual([
      ['as a literal', 'as a string'],
      ['as a literal', 'as a string'],
    ]);
  });

  it('is written by each type its own codec inside tuples too', async () => {
    const pairs: Showing = {
      declarations: [
        'struct Box<T> { value: T }',
        'fn toJson(self: Box<"a">) -> Json: "as a literal"',
        'fn toJson(self: Box<String>) -> Json: "as a string"',
        'extern fn show(pairs: ((Box<"a">, Int), (Box<String>, Int)))',
      ],
      key: 'main.show(((main.Box<"a">, Int), (main.Box<String>, Int)))',
    };
    const seen = await shown(pairs, [
      'const pair: (Box<"a">, Int) = (Box{value: "a"}, 1)',
      'show((pair, pair))',
      'show((pair, pair))',
    ]);
    const written = [
      ['as a literal', 1n],
      ['as a string', 1n],
    ];
    expect(seen).toEqual([written, written]);
  });
});

describe('a value two instances give a host', () => {
  it("is written by each instance's codec, reading its own context constant", async () => {
    const program = compiledText(
      [
        "import Json from 'json'\nimport * as runtime from 'runtime'",
        'ista const label: String = runtime.id()',
        'struct Item { name: String }',
        'ista fn toJson(self: Item) -> Json: label',
        'const shared = Item{name: "a"}',
        'extern fn show(item: Item)',
        'live async fn main(): await runtime.run(runtime.id()) _main()',
        'ista async fn _main():',
        '  show(shared)',
        '  show(shared)',
      ].join('\n'),
    );
    const seen: unknown[] = [];
    const host: HostExterns = {
      'main.show(main.Item)': ([value]) => {
        seen.push(value);
        return null;
      },
    };
    const test = testRuntime({ host });
    await startToEnd(test, program, { instance: 'one' });
    await startToEnd(test, program, { instance: 'two' });
    expect(new Set(seen).size).toBe(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[3]).toBe(seen[2]);
  });
});
