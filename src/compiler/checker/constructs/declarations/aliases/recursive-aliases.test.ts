/**
 * Recursive type aliases (proposal 5 §2, notes 6 and 11): guarded vs unguarded self-reference
 * (5106), finiteness (5211), regularity, equi-recursive identity ('typeKey' equal iff 'sameType',
 * 'Tree<T>' instantiated with 'Int' equal to 'Tree<Int>', two aliases with equal bodies one type),
 * flattening in a union ('Tree<Int> | Int' is 'Tree<Int>'), unfolding without fold/unfold,
 * exhaustive pattern matching, static functions, and 'typeText'.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../../../compile.test-kit.ts';
import { lines } from '../../../../parser/parse.test-kit.ts';
import { type Files, idOf } from '../../../../program/program.test-kit.ts';
import { programModule } from '../../../../program/program.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import { reported } from '../../../check.test-kit.ts';
import { checkProgram } from '../../../check.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import { typeKeys } from '../../../types/identity/type-keys.ts';
import { substitute, substitutionFor } from '../../../types/parts/substitution.ts';
import type { Type } from '../../../types/type/index.ts';
import { intType, stringType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';

function parameterTypesOf(source: string): {
  readonly types: readonly Type[];
  readonly fn: FunctionDeclaration;
  readonly checker: ReturnType<typeof checkProgram>;
} {
  const program = stdProgramOf({ 'main.ista': source });
  const checker = checkProgram(program);
  const module = idOf('main.ista');
  const fn = programModule(program, module).tree.root.items.find(
    (item): item is FunctionDeclaration => item.kind === 'FunctionDeclaration',
  );
  if (fn === undefined) {
    throw new Error('Expected a FunctionDeclaration in main.ista');
  }
  return {
    types: checker.parametersOf(fn).map((parameter) => parameter.type),
    fn,
    checker,
  };
}

describe('guarded vs unguarded self-reference (§2)', () => {
  it.each([
    ['type argument (Tree<T>)', 'type Tree<T> = T | Array<Tree<T>>'],
    ['map type argument', 'type NestedMap = Map<String, NestedMap>'],
    ['field of a shape (List)', 'type List = { head: Int, tail: List? }'],
    ['tuple element behind optional', 'type Chain = (Int, Chain?)'],
    ['function type parameter and result', 'type Machine = fn(Int) -> Machine'],
    [
      'mutual recursion across two aliases',
      lines('type Forest<T> = Array<Node<T>>', 'type Node<T> = { value: T, children: Forest<T> }'),
    ],
    [
      'associated type in a struct referring to a recursive alias',
      lines(
        'type Tree<T> = T | Array<Tree<T>>',
        'struct Box<T> { value: T, type Nested = Tree<T> }',
      ),
    ],
  ])('accepts guarded recursive alias: %s', (_name, decls) => {
    expect(reported(`${decls}\nfn use(): ()`)).toEqual(reportedNothing);
  });

  it.each([
    ['direct self-reference', 'type A = A', ['A']],
    ['union member (type A = A | Int)', 'type A = A | Int', ['A']],
    ['union member after another (type A = Int | A)', 'type A = Int | A', ['A']],
    ['optional sugar (type A = A?)', 'type A = A?', ['A']],
    ['mutual unguarded cycle', lines('type A = B | Int', 'type B = A | String'), ['A', 'B']],
  ])('reports 5106 on unguarded alias cycle: %s', (_name, decls, names) => {
    const result = reported(decls);
    expect(result.codes).toEqual(names.map(() => checkerDiagnostics.aliasCycle.code));
    expect(result.spanTexts).toEqual(names);
  });
});

describe('finiteness and regularity rules (§2, §3.1, §3.5)', () => {
  it('reports 5211 when a recursive shape holds itself by value without an optional or collection', () => {
    expect(reported('type BadList = { head: Int, tail: BadList }')).toEqual(
      reportedOnce(checkerDiagnostics.recursiveField.code, 'tail'),
    );
    const mutual = lines('type A = { next: B }', 'type B = { back: A }');
    expect(reported(mutual).codes).toContain(checkerDiagnostics.recursiveField.code);
  });

  it('rejects a recursive tuple that holds itself by value without an optional or collection', () => {
    expect(reported('type InfiniteTuple = (Int, InfiniteTuple)').codes.length).toBeGreaterThan(0);
  });

  it.each([
    ['growing type argument W<Array<T>>', 'type W<T> = T | Array<W<Array<T>>>', 'W'],
    ['growing tuple type argument W<(T,)>', 'type W<T> = { head: T, tail: W<(T,)>? }', 'W'],
    ['permuted type arguments Flip<B, A>', 'type Flip<A, B> = (A, Flip<B, A>?)', 'Flip'],
    [
      'mutually recursive expanding aliases',
      lines('type P<T> = T | Array<Q<Array<T>>>', 'type Q<U> = U | Array<P<U>>'),
      'P',
    ],
  ])('rejects irregular recursive alias (%s)', (_name, decls, offending) => {
    const result = reported(decls);
    expect(result.codes.length).toBeGreaterThan(0);
    expect(result.spanTexts).toContain(offending);
  });

  it('reports an irregular alias at the alias, as 5128', () => {
    expect(reported('type W<T> = T | Array<W<Array<T>>>')).toEqual(
      reportedOnce(checkerDiagnostics.irregularAlias.code, 'W'),
    );
  });

  it('closes an alias naming itself in a union inside its own union body, which flattens', () => {
    const declarations = lines(
      'type R = Int | Array<R?>',
      'fn count(r: R) -> Int:',
      '  match r:',
      '    case Int as n: return n',
      '    case Array<R?> as items: return items.length()',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Int', 'return count([1, none, [2]]) + count(4)', declarations)).toBe(7);
  });

  it('refuses an alias reached again where it must be known first, guarded or not (5106)', () => {
    for (const body of ['{ k: keyof A }', '{ v: A["k"] }', '{ d: A.Data }']) {
      expect(reported(`type A = ${body}`).codes).toContain(checkerDiagnostics.aliasCycle.code);
    }
  });

  it('accepts a multi-parameter recursive alias that passes its parameters in order', () => {
    expect(reported('type BiTree<A, B> = (A, B) | Array<BiTree<A, B>>')).toEqual(reportedNothing);
  });
});

describe('identity, typeKey, sameType, substitution and union absorption (§2, note 11)', () => {
  it('makes Tree<T> instantiated with Int equal to Tree<Int>, with the same typeKey', () => {
    const { types, fn, checker } = parameterTypesOf(
      lines(
        'type Tree<T> = T | Array<Tree<T>>',
        'fn check<T>(open: Tree<T>, concrete: Tree<Int>): ()',
      ),
    );
    const [openTree, concreteTree] = types;
    if (openTree === undefined || concreteTree === undefined) {
      throw new Error('Expected two parameter types');
    }
    const instantiated = substitute(
      openTree,
      substitutionFor(fn.typeParameters, [intType]),
      checker.typeRules,
    );
    expect(sameType(instantiated, concreteTree)).toBe(true);
    expect(typeKeys.typeKey(instantiated)).toBe(typeKeys.typeKey(concreteTree));
  });

  it('makes two recursive aliases with equal bodies one type (equi-recursive), inside containers too', () => {
    const { types } = parameterTypesOf(
      lines(
        'type A = Int | Array<A>',
        'type B = Int | Array<B>',
        'fn check(a1: A, a2: A, b: B): ()',
      ),
    );
    const [a1, a2, b] = types;
    if (a1 === undefined || a2 === undefined || b === undefined) {
      throw new Error('Expected three parameter types');
    }
    expect(sameType(a1, a2)).toBe(true);
    expect(sameType(a1, b)).toBe(true);
    expect(typeKeys.typeKey(a1)).toBe(typeKeys.typeKey(b));
    expect(typeText(b)).toBe('B');
    const mixed = lines(
      'type A = Int | Array<A>',
      'type B = Int | Array<B>',
      'fn mix(xs: Array<A>) -> Array<B>: xs',
    );
    expect(reported(mixed)).toEqual(reportedNothing);
    expect(mainGives('Int', 'return mix([1, [2]]).length()', mixed)).toBe(2);
  });

  it('passes recursive form data into a domain function written with its own alias', () => {
    const declarations = lines(
      'type FormCategory = { name: String, children: Array<FormCategory> }',
      'type CrmCategory = { name: String, children: Array<CrmCategory> }',
      'fn saveTree(c: CrmCategory) -> Int: c.children.length()',
      'fn submitted() -> FormCategory:',
      '  return FormCategory{name: "a", children: [FormCategory{name: "b", children: []}]}',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Int', 'return saveTree(submitted())', declarations)).toBe(1);
  });

  it('builds a literal against an alias flattening another as the one member it fits', () => {
    const declarations = lines(
      'type Tree = Int | Array<Tree>',
      'type Forest = Tree | Array<Forest>',
      'fn size(f: Forest) -> Int:',
      '  match f:',
      '    case Int: return 1',
      '    case Array<Tree> as items: return items.length()',
      'fn same(t: Tree) -> Forest: t',
      'fn one() -> Int:',
      '  const b: Forest = [1]',
      '  return size(b)',
      'fn two() -> Int:',
      '  const b: Forest = [1, [2]]',
      '  return size(b)',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(
      mainGives('Int', 'return size(same([1, 2, 3])) * 100 + one() * 10 + two()', declarations),
    ).toBe(312);
  });

  it('absorbs members that a recursive union alias already holds (Tree<Int> | Int is Tree<Int>)', () => {
    const { types } = parameterTypesOf(
      lines(
        'type Tree<T> = T | Array<Tree<T>>',
        'fn check(t: Tree<Int>, tOrInt: Tree<Int> | Int, tOrArr: Tree<Int> | Array<Tree<Int>>): ()',
      ),
    );
    const [t, tOrInt, tOrArr] = types;
    if (t === undefined || tOrInt === undefined || tOrArr === undefined) {
      throw new Error('Expected three parameter types');
    }
    expect(sameType(t, tOrInt)).toBe(true);
    expect(sameType(t, tOrArr)).toBe(true);
  });

  it('flattens a recursive union in a union: Tree<Int> | String holds its members and String', () => {
    const { types } = parameterTypesOf(
      lines(
        "import Json from 'json'",
        'type Tree<T> = T | Array<Tree<T>>',
        'fn check(t: Tree<Int>, u: Tree<Int> | String, j: Json | Int, o: Json?, k: Json): ()',
      ),
    );
    const [t, u, j, o, k] = types;
    expect(u?.kind === 'union' && u.members.length === 3 && t !== undefined).toBe(true);
    expect(j !== undefined && o !== undefined && k !== undefined).toBe(true);
    expect(
      [j, o].map((each) => each !== undefined && k !== undefined && sameType(each, k)),
    ).toEqual([true, true]);
    expect([j, o].map((each) => (each === undefined ? '' : typeText(each)))).toEqual([
      'Json',
      'Json',
    ]);
  });

  it('spells a recursive alias by its alias name in typeText and supports static functions on it', () => {
    const { types } = parameterTypesOf(
      lines(
        'type Tree<T> = T | Array<Tree<T>>',
        'type List = { head: Int, tail: List? }',
        'fn check(t: Tree<Int>, l: List): ()',
      ),
    );
    expect(types.map((type) => typeText(type))).toEqual(['Tree<Int>', 'List']);
    const decls = lines(
      'type Tree<T> = T | Array<Tree<T>>',
      'fn Tree.leaf<T>(value: T) -> Tree<T>: value',
    );
    expect(mainGives('Bool', 'Tree.leaf(42) is Int', decls)).toBe(true);
  });

  it('holds typeKey(a) === typeKey(b) iff sameType(a, b) over generated types built with recursive aliases', () => {
    const { types } = parameterTypesOf(
      lines(
        'type Tree<T> = T | Array<Tree<T>>',
        'type Other<T> = T | Array<Other<T>>',
        'type List = { head: Int, tail: List? }',
        'fn check(a: Tree<Int>, b: Tree<Int>, c: Tree<String>, d: Other<Int>, e: List, f: List): ()',
      ),
    );
    const pool = [...types, intType, stringType];
    fc.assert(
      fc.property(fc.constantFrom(...pool), fc.constantFrom(...pool), (first, second) => {
        expect(typeKeys.typeKey(first) === typeKeys.typeKey(second)).toBe(sameType(first, second));
      }),
      { numRuns: 50 },
    );
  });
});

describe('recursive aliases through tuples and functions, which have no entry of their own (§3.17)', () => {
  it('builds and reads a chain through a tuple and an optional', () => {
    const decls = lines(
      'type Chain = (Int, Chain?)',
      'fn total(c: Chain?) -> Int:',
      '  match c:',
      '    case None: return 0',
      '    case (n, rest): return n + total(rest)',
      'fn run() -> Int:',
      '  const c: Chain = (1, (2, none))',
      '  return total(c)',
    );
    expect(mainGives('Int', 'run()', decls)).toBe(3);
  });

  it('lowers a function type that returns itself, held in a struct', () => {
    const decls = lines(
      'type Machine = fn(Int) -> Machine',
      'struct Holder { step: Machine }',
      'fn start(n: Int) -> Machine: start',
      'fn steps(h: Holder) -> Int: 2',
    );
    expect(mainGives('Int', 'steps(Holder{step: start})', decls)).toBe(2);
  });
});

describe('using recursive aliases without fold/unfold: conversions, fields and exhaustive matching (§2)', () => {
  it('converts values into a recursive union at any depth and matches them exhaustively', () => {
    const decls = lines(
      'type Tree<T> = T | Array<Tree<T>>',
      'fn sumTree(t: Tree<Int>) -> Int:',
      '  match t:',
      '    case Int as n: n',
      '    case Array<Tree<Int>> as children:',
      '      let total = 0',
      '      for child in children:',
      '        total += sumTree(child)',
      '      total',
    );
    const run = lines(
      'fn run() -> Int:',
      '  const tree: Tree<Int> = [1, [2, 3], [[4], 5]]',
      '  sumTree(tree)',
    );
    expect(mainGives('Int', 'run()', lines(decls, run))).toBe(15);
  });

  it('constructs and traverses a recursive shape (List) and reports non-exhaustive matches', () => {
    const decls = lines(
      'type List = { head: Int, tail: List? }',
      'fn sumList(list: List?) -> Int:',
      '  match list:',
      '    case None: 0',
      '    case struct{head, tail}: head + sumList(tail)',
      'fn run() -> Int:',
      '  const items: List =',
      '    head: 10',
      '    tail:',
      '      head: 20',
      '      tail:',
      '        head: 30',
      '        tail: none',
      '  sumList(items)',
    );
    expect(mainGives('Int', 'run()', decls)).toBe(60);

    const nonExhaustive = lines(
      'type Tree<T> = T | Array<Tree<T>>',
      'fn bad(t: Tree<Int>) -> Int:',
      '  match t:',
      '    case Int as n: n',
    );
    expect(reported(nonExhaustive).codes).toContain(checkerDiagnostics.nonExhaustiveMatch.code);
  });
});

describe('a recursive type in a compiled program (docs/arch/definition.md)', () => {
  const entryNames = (main: string, others: Files = {}) =>
    compiledDefinition(stdProgramOf({ 'main.ista': main, ...others }), 'main.ista').types.map(
      (entry) => entry.name,
    );
  const program = lines(
    "import Tree from 'a.ista'",
    'type Forest = Tree | Array<Forest>',
    'fn size(f: Forest) -> Int:',
    '  match f:',
    '    case Int as n: return n',
    '    case _: return 2',
    'async fn main() -> Future<Int>:',
    '  const f: Forest = [1, [2]]',
    '  return size(f)',
  );

  it('names one entry for equal recursive types by the preferred alias, whichever was written', () => {
    const names = entryNames(program, { 'a.ista': 'type Tree = Int | Array<Tree>' });
    expect(names.filter((name) => name === 'a.ista.Tree')).toHaveLength(1);
    expect(names.filter((name) => name?.endsWith('Forest') === true)).toEqual([]);
  });

  it('keeps every entry when an alias of the same type is added in another module', () => {
    const before = entryNames(program, { 'a.ista': 'type Tree = Int | Array<Tree>' });
    const after = entryNames(program, {
      'a.ista': 'type Tree = Int | Array<Tree>',
      'b.ista': 'type Nest = Int | Array<Nest>',
    });
    expect(after).toEqual(before);
  });
});
