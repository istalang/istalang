/**
 * Uses of type `match`es as instantiations reach them (§3.5, §3.17): a recursive use stays one
 * type when its arguments are substituted, recursive or not as the substituted use decides; a use
 * with fixed arguments in its own case is a finite recursive type; a literal matches a case naming
 * its base only matched whole; and a `struct{…}` literal passed as an argument takes its type from
 * the parameter, as a typed one would. A use no case matches, reached by an instantiation, is
 * refused where the instantiation is written: test/corpus/computed/invalid-instantiated-match.ista.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { substitute, substituteKept } from '../../src/compiler/checker/types/substitution.ts';
import { intType } from '../../src/compiler/checker/types/type.ts';
import { typeKeys } from '../../src/compiler/checker/types/type-keys.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations.ts';
import { codesOf, resolveWrittenTypes, runMain, spelledTypeOf } from './computed.test-kit.ts';

/** `Data<D>` is recursive for a `Node`, which holds nodes, and plain for a `Leaf`. */
const dataDecls = [
  'struct Node<T> { value: T, next: Array<Node<T>> }',
  'struct Leaf<T> { value: T }',
  'type Data<D> = match D:',
  '  case Node<infer T>: { value: T, next: Array<Data<D>> }',
  '  case Leaf<infer T>: { value: T }',
];

describe('recursive type `match` uses under substitution', () => {
  it('keep one identity whichever way a recursive use is substituted', () => {
    const { checker } = resolveWrittenTypes(
      ['Int'],
      [...dataDecls, 'fn gen<T>(x: Data<Node<T>>): ()'],
    );
    const module = [...checker.program.modules.values()].find((each) =>
      each.tree.root.items.some((item) => item.kind === 'FunctionDeclaration'),
    );
    const gen = module?.tree.root.items.find(
      (item): item is FunctionDeclaration =>
        item.kind === 'FunctionDeclaration' && item.name.text === 'gen',
    );
    const [parameter] = gen === undefined ? [] : checker.parametersOf(gen);
    const [typeParameter] = gen?.typeParameters ?? [];
    expect(parameter?.type.kind).toBe('recursive');
    if (parameter?.type.kind !== 'recursive' || typeParameter?.kind !== 'TypeParameter') {
      return;
    }
    const rules = checker.typeRules;
    const substitution = new Map([[typeParameter, intType]]);
    const shape = rules.recursiveShape(parameter.type);
    expect(typeKeys.typeKey(substituteKept(shape, substitution, rules))).toBe(
      typeKeys.typeKey(substitute(parameter.type, substitution, rules)),
    );
  });

  it('agree with the program written for the arguments, recursive or not', () => {
    const generic = [
      ...dataDecls,
      'fn firstOf<D>(d: Data<D>, read: fn(Data<D>) -> Int) -> Int: read(d)',
    ];
    const recursive =
      'firstOf<Node<Int>>(struct{value: 4, next: []}, fn(d): d.value + d.next.length())';
    const plain = 'firstOf<Leaf<Int>>(struct{value: 7}, fn(d): d.value)';
    expect(runMain('Int', `${recursive} + ${plain}`, generic)).toBe(11);
    const written = [
      ...dataDecls,
      'fn nodeFirst(d: Data<Node<Int>>) -> Int: d.value + d.next.length()',
      'fn leafFirst(d: Data<Leaf<Int>>) -> Int: d.value',
    ];
    expect(
      runMain(
        'Int',
        'nodeFirst(struct{value: 4, next: []}) + leafFirst(struct{value: 7})',
        written,
      ),
    ).toBe(11);
  });
});

describe('a type `match` using itself with fixed arguments', () => {
  const selfDecls = ['type T1<T> = match T:', '  case _: { next: Array<T1<Int>> }'];

  it('is a finite recursive type, whatever its own argument', () => {
    const { types, diagnosticCodes } = resolveWrittenTypes(['T1<String>', 'T1<Int>'], selfDecls);
    expect(diagnosticCodes).toEqual([]);
    expect(types.map((type) => type.kind)).toEqual(['anonymous', 'recursive']);
    expect(
      runMain(
        'Int',
        'const v: T1<String> = struct{next: [struct{next: []}, struct{next: []}]}\n  v.next.length()',
        selfDecls,
      ),
    ).toBe(2);
  });

  it('stays opaque over a type parameter, which may be `Never`, a union of no members', () => {
    expect(codesOf(...selfDecls, 'fn f<T>(x: T1<T>) -> Int: x.next.length()')).not.toEqual([]);
  });
});

describe('a literal matching a case naming its base type', () => {
  const decls = [
    'struct Box<T> { v: T }',
    'type M<D> = match D:',
    '  case String: "base"',
    '  case Box<String>: "boxed"',
    '  case _: "other"',
  ];
  const reduced = (written: string) => {
    const { checker, types } = resolveWrittenTypes([written], decls);
    const [type] = types;
    return type === undefined ? undefined : checker.typeKeys.typeKey(type);
  };

  it('matches it matched whole, as the subject or a member a union distributes', () => {
    expect(reduced('M<"a">')).toBe(reduced('"base"'));
    expect(reduced('M<"a" | Int>')).toBe(reduced('"base" | "other"'));
    expect(spelledTypeOf('M<"a">', decls)).toBe('M<"a">');
  });

  it('matches exactly inside another type, a part of a different type', () => {
    expect(reduced('M<Box<"a">>')).toBe(reduced('"other"'));
    expect(reduced('M<Box<String>>')).toBe(reduced('"boxed"'));
  });
});

describe('a `struct{…}` literal passed as a call argument', () => {
  it('takes its type from the parameter, as a typed literal would', () => {
    expect(
      codesOf('fn g(x: { a: Array<Int> }) -> Int: 1', 'fn h() -> Int: g(struct{a: []})'),
    ).toEqual([]);
    expect(
      runMain(
        'Int',
        'g(struct{a: [], b: struct{c: none}}) + g(struct{a: [1, 2], b: struct{c: none}})',
        ['fn g(x: { a: Array<Int>, b: { c: Int? } }) -> Int: x.a.length() + (x.b.c ?? 1)'],
      ),
    ).toBe(4);
  });

  it('builds the recursive type a parameter expects', () => {
    const decls = [
      'struct Field<T> { value: T? }',
      'struct Many<Row> { rows: Array<Row> }',
      'type TreeOf<D> = match D:',
      '  case Field<infer T>: T',
      '  case Many<infer R>: Array<TreeOf<R>>',
      '  case struct: { [F in keyof D]: TreeOf<D[F]> }',
      'struct Tree { label: Field<String>, children: Many<Tree> }',
      'fn count(t: TreeOf<Tree>) -> Int:',
      '  let total = 1',
      '  for child in t.children:',
      '    total += count(child)',
      '  total',
    ];
    const tree =
      'struct{label: "root", children: [struct{label: "a", children: []}, struct{label: "b", children: []}]}';
    expect(runMain('Int', `count(${tree})`, decls)).toBe(3);
  });

  it('agrees with the literal given the parameter type, for any fields a call decides', () => {
    const field = fc.constantFrom(
      { type: 'Array<Int>', literal: '[]', length: 'x.f.length()' },
      { type: 'Int?', literal: 'none', length: '(x.f ?? 0)' },
      { type: 'Array<String>', literal: '["a"]', length: 'x.f.length()' },
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(fc.constantFrom('p', 'q', 'r'), field), {
          minLength: 1,
          maxLength: 3,
          selector: ([name]) => name,
        }),
        (fields) => {
          const shape = `{ ${fields.map(([name, f]) => `${name}: ${f.type}`).join(', ')} }`;
          const literal = `struct{${fields.map(([name, f]) => `${name}: ${f.literal}`).join(', ')}}`;
          const total = fields.map(([name, f]) => f.length.replace('x.f', `x.${name}`)).join(' + ');
          const decls = [`fn g(x: ${shape}) -> Int: ${total}`];
          expect(runMain('Int', `g(${literal})`, decls)).toBe(
            runMain('Int', `const typed: ${shape} = ${literal}\n  g(typed)`, decls),
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('a type `match` a field default reaches', () => {
  const helper = [
    'type OnlyBox<D> = match D:',
    '  case Box<infer T>: T',
    'struct Box<T> { value: T }',
    'fn helper<D>() -> Int:',
    '  const _: OnlyBox<D>? = none',
    '  0',
  ];
  it('is checked where its struct or variant is instantiated, as a field type is', () => {
    expect(
      codesOf(
        ...helper,
        'struct Holder<D>:',
        '  x: Int = helper<D>()',
        'fn g() -> Int: Holder<Int>{}.x',
      ),
    ).toEqual([5170]);
    expect(
      codesOf(
        ...helper,
        'enum Choice<D>:',
        '  Held { x: Int = helper<D>() }',
        'fn g(c: Choice<Int>): ()',
      ),
    ).toEqual([5170]);
  });
});
