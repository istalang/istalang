/**
 * A type holding recursion in a compiled program is spelled by its structure, never by the alias
 * or representation lowering met it through (§4.6, docs/arch/definition.md): its entry is named
 * by its table key, whichever aliases name it, a computed associated type no alias names among
 * them. So a union holding it orders its variants alike however it was written, and each value,
 * `none` among them, is its own variant through every spelling.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../../test/timeouts.ts';
import { resolveWrittenTypes } from '../../../../test/written-types.test-kit.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../compile.test-kit.ts';
import { tableKey } from './names.ts';

const modules = {
  'a.ista': 'type FormTree<T> = T | Array<FormTree<T>>',
  'b.ista': 'type CrmTree<T> = T | Array<CrmTree<T>>',
};

/** The type entries' names of a program whose `main` calls `first`, then `second`. */
function entryNames(first: string, second: string): readonly string[] {
  const main = [
    "import FormTree from 'a.ista'",
    "import CrmTree from 'b.ista'\nimport * as runtime from 'runtime'",
    'fn fromForm(t: FormTree<Int>) -> Int: 1',
    'fn fromCrm(t: CrmTree<Int>) -> Int: 2',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
    `  return ${first}([1, [2]]) + ${second}([3])`,
  ].join('\n');
  return compiledDefinition(stdProgramOf({ 'main.ista': main, ...modules }), 'main.ista').types.map(
    (entry) => entry.name ?? '',
  );
}

describe("a generic recursive alias's instantiation in a compiled program", () => {
  it('is one entry, named by its structure whichever alias lowering meets first', () => {
    const declarations = ['type Tree<T> = T | Array<Tree<T>>'];
    const { checker, types } = resolveWrittenTypes(['Tree<Int>'], declarations);
    const tree = tableKey(checker, types[0] ?? unreachable('A type was written.'));
    const names = entryNames('fromForm', 'fromCrm');
    expect(names.filter((name) => name === tree)).toHaveLength(1);
    expect(entryNames('fromCrm', 'fromForm')).toEqual(names);
  });
});

/**
 * A tree whose `Seen` is a recursive computed associated type no alias names, `alias` naming its
 * node too; `Many.first` hands its factory `none` as `R.Seen?` inside a generic instance.
 */
function seenTree(alias: string): string {
  return `trait Node:
  type Seen
struct Field<T>:
  v: T? = none
  type Seen = T?
struct Many<R is Node>:
  make: fn(R.Seen?) -> String
  type Seen = Array<R.Seen>
fn first<R is Node>(self: Many<R>) -> String: (self.make)(none)
struct Group<S is struct { [_] is Node }>:
  fields: S
  type Seen = match S:
    case _: { [F in keyof S]: S[F].Seen }
struct M:
  name: Field<String>
  children: Many<Group<M>>
type ${alias} = Group<M>
fn viaAlias(x: ${alias}.Seen?) -> String:
  match x:
    case None: "none"
    case _: "value"
fn viaGroup(x: Group<M>.Seen?) -> String:
  match x:
    case None: "none"
    case _: "value"`;
}

/** `none` read through each spelling of `seenTree`'s `Seen?`, built through each. */
function readers(alias: string): readonly string[] {
  return [
    'viaAlias(none)',
    'viaGroup(none)',
    'Many<Group<M>>{make: viaAlias}.first()',
    `Many<${alias}>{make: viaGroup}.first()`,
  ];
}

/** Aliases spelling before and after `None` and `Group`, the names variants were sorted by. */
const aliasName = fc.constantFrom('Alpha', 'Category', 'Groups', 'Nest', 'Nonesuch', 'Row', 'Zeta');

/** An alias of `seenTree` and the order `main` reads its spellings in. */
const spelledReads = aliasName.chain((alias) =>
  fc.shuffledSubarray([...readers(alias)], { minLength: 4 }).map((reads) => ({ alias, reads })),
);

describe('a union holding a recursive type no alias names', () => {
  it('holds `none` as `None` through every spelling, whichever lowering meets first', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(spelledReads, async ({ alias, reads }) => {
        const body = `[${reads.join(', ')}].join(" ")`;
        expect(await mainGives('String', body, seenTree(alias))).toBe('none none none none');
      }),
      { numRuns: 12 },
    );
  });

  it('spells it alike through every alias, as the type table orders variants by', () => {
    const dataOf = `type DataOf<D> = match D:
  case Field<infer T>: T?
  case Many<infer R>: Array<DataOf<R>>
  case Group<infer S>: DataOf<S>
  case struct: { [F in keyof D]: DataOf<D[F]> }`;
    fc.assert(
      fc.property(aliasName, (alias) => {
        const declarations = `${seenTree(alias)}\n${dataOf}`;
        const written = [
          `${alias}.Seen`,
          'Group<M>.Seen',
          `DataOf<${alias}>`,
          `${alias}.Seen?`,
          'Group<M>.Seen?',
          'DataOf<Group<M>>?',
        ];
        const { checker, types } = resolveWrittenTypes(written, [declarations]);
        const [viaAlias, viaGroup, viaMatch, optAlias, optGroup, optMatch] = types.map((type) =>
          tableKey(checker, type),
        );
        expect(viaAlias).toBe(viaGroup);
        expect(viaMatch).toBe(viaGroup);
        expect(optAlias).toBe(optGroup);
        expect(optMatch).toBe(optGroup);
      }),
      { numRuns: 7 },
    );
  });
});

/** A recursive union whose cycle closes at a member, and the same union written out. */
const writtenOut = `type R = { x: Int } | Array<R?>
type Written = { x: Int } | Array<R?>
fn viaR(w: R) -> String:
  match w:
    case Array<R?>: "array"
    case _: "struct"
fn viaWritten(w: Written) -> String:
  match w:
    case Array<R?>: "array"
    case _: "struct"`;

/**
 * One unnamed cycle reached as a plain associated type's shape and as a recursive type `match`,
 * beside `true` (`"struct …"` < `"true"` < `"~[…]"` if the shape were spelled by its parts).
 */
const shiftedCycle = `trait Node:
  type Seen
struct Many<R is Node>:
  rows: Array<R> = []
  type Seen = Array<R.Seen>
struct Wrap<R is Node>:
  v: R? = none
  type Seen = { b: Array<R.Seen> }
struct Group<S is struct { [_] is Node }>:
  fields: S
  type Seen = match S:
    case _: { [F in keyof S]: S[F].Seen }
struct M:
  a: Wrap<Group<M>>
struct N:
  a: Group<Sub>
struct Sub:
  b: Many<Group<N>>
fn viaWrap(x: Wrap<Group<M>>.Seen | true) -> String:
  match x:
    case true: "true"
    case _: "seen"
fn viaGroup(x: Group<Sub>.Seen | true) -> String:
  match x:
    case true: "true"
    case _: "seen"`;

/** `json.Json`, and the same union through an alias of its own made optional. */
const realiased = `import Json from "json"
type MyJson = Bool | Int | Float | String | Array<MyJson?> | Map<String, MyJson?>
fn viaJson(j: Json) -> String:
  match j:
    case Array<Json>: "array"
    case _: "other"
fn viaMine(j: MyJson?) -> String:
  match j:
    case Array<MyJson?>: "array"
    case _: "other"`;

describe('one union holding recursion, written two ways', () => {
  it('holds each value in its own variant whichever way built it and reads it', async () => {
    const struct = 'const a: R = struct{x: 1}\nconst b: Written = struct{x: 2}';
    const arrays = 'const c: R = [none]\nconst d: Written = [none]';
    const reads = '[viaR(a), viaR(b), viaWritten(a), viaWritten(b), viaR(d), viaWritten(c)]';
    expect(await mainGives('String', `${struct}\n${arrays}\n${reads}.join(" ")`, writtenOut)).toBe(
      'struct struct struct struct array array',
    );
    const shifted = [
      'const s: Wrap<Group<M>>.Seen = struct{b: []}',
      'const a: Wrap<Group<M>>.Seen | true = true',
      'const b: Wrap<Group<M>>.Seen | true = s',
    ].join('\n');
    const shiftedReads = '[viaWrap(a), viaGroup(a), viaWrap(b), viaGroup(b)].join(" ")';
    expect(await mainGives('String', `${shifted}\n${shiftedReads}`, shiftedCycle)).toBe(
      'true true seen seen',
    );
    const built = 'const a: Json = [1]\nconst b: MyJson? = [2]';
    const read = '[viaJson(a), viaMine(b), viaJson(b), viaMine(a)].join(" ")';
    expect(await mainGives('String', `${built}\n${read}`, realiased)).toBe(
      'array array array array',
    );
  });

  it('spells it alike either way', () => {
    for (const [declarations, written] of [
      [writtenOut, ['R', 'Written']],
      [shiftedCycle, ['Wrap<Group<M>>.Seen', 'Group<Sub>.Seen']],
      [realiased, ['Json', 'MyJson?']],
    ] as const) {
      const { checker, types } = resolveWrittenTypes(written, [declarations]);
      const [first, second] = types.map((type) => tableKey(checker, type));
      expect(first).toBe(second);
    }
  });
});
