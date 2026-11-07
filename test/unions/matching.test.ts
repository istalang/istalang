/**
 * Pattern matching and exhaustiveness on unions and literal types (docs/proposals/3-union-types.md
 * §3, §5, note 5, note 12): `None`, type patterns (including `case Int` on `Int?` and base-type
 * patterns selecting literal members), literal patterns (`case 1` on `Int?`), enum variants (bare
 * vs qualified), generic members with type arguments, shape members by field or alias, remaining
 * binder types, alternatives binding unions, collapse keeping the first arm, and fast-check
 * properties over generated member sets.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reported } from '../../src/compiler/checker/check.test-kit.ts';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, hoverCodeAt, runMain } from './unions.test-kit.ts';

const matchDecls = [
  'type Status = "draft" | "sent" | "failed"',
  'type Point = { x: Int, y: Int }',
  'struct Email { to: String }',
  'struct Sms { number: String }',
  'type Contact = Email | Sms',
  'enum Decision:',
  '  Approved(by: String)',
  '  Expired',
  'struct Box<T> { value: T }',
];

describe('matching on unions and literal types (§3, §5)', () => {
  it('runs the proposal describe and label examples with remaining-type narrowing', () => {
    const code = [
      ...matchDecls,
      'fn describe(x: Int | String | None) -> String:',
      '  match x:',
      '    case None: "nothing"',
      '    case Int as n: `number ${n}`',
      '    case s: s',
      'fn label(s: Status) -> String:',
      '  match s:',
      '    case "draft": "Draft"',
      '    case "sent" | "failed": "Done"',
      'fn contactTo(c: Contact) -> String:',
      '  match c:',
      '    case Email{to}: "mail:" + to',
      '    case Sms{number}: "sms:" + number',
    ];
    expect(
      runMain(
        'String',
        '`${describe(none)}|${describe(42)}|${describe("ok")}|${label("draft")}|${label("failed")}|${contactTo(Email{to: "cfo"})}`',
        code,
      ),
    ).toBe('nothing|number 42|ok|Draft|Done|mail:cfo');
  });

  it('compiles `case Int` and `case 1` against `Int?`, and rejects removed `Some`', () => {
    expect(
      runMain(
        'String',
        '`${checkInt(5)}:${checkInt(none)}:${checkLit(1)}:${checkLit(2)}:${checkLit(none)}`',
        [
          'fn checkInt(x: Int?) -> String:',
          '  match x:',
          '    case Int as n: `int:${n}`',
          '    case None: "none"',
          'fn checkLit(x: Int?) -> String:',
          '  match x:',
          '    case 1: "one"',
          '    case None: "none"',
          '    case n: `other:${n}`',
        ],
      ),
    ).toBe('int:5:none:one:other:2:none');

    expect(
      codesOf(
        'fn oldSome(x: Int?) -> Int:',
        '  match x:',
        '    case Some(value): value',
        '    case None: 0',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('selects all literal members of a base type when matching that base type', () => {
    const lines = [
      ...matchDecls,
      'fn split(x: Status | Int) -> String:',
      '  match x:',
      '    case String as ‸s: s',
      '    case Int as n: String(n)',
    ];
    // A union flattens the aliases written in it (§2), so the members `case String` selects print
    // as the literals they are, not as the alias `Status` they came from.
    expect(hoverCodeAt(...lines)).toEqual(['(variable) s: "draft" | "sent" | "failed"']);
    expect(
      runMain(
        'String',
        'split("sent") + ":" + split(7)',
        lines.map((l) => l.replace('‸', '')),
      ),
    ).toBe('sent:7');
  });

  it('binds the alias a pattern names when it selects all of the alias union’s members', () => {
    const lines = [
      ...matchDecls,
      'fn split(x: Status | Int) -> String:',
      '  match x:',
      '    case Status as ‸s: s',
      '    case Int as n: String(n)',
    ];
    expect(hoverCodeAt(...lines)).toEqual(['(variable) s: Status = "draft" | "sent" | "failed"']);
  });

  it('matches bare variants through enum members, and requires qualification when ambiguous', () => {
    expect(
      runMain('String', 'show(Approved("legal")) + ":" + show(Expired) + ":" + show(9)', [
        ...matchDecls,
        'fn show(x: Decision | Int) -> String:',
        '  match x:',
        '    case Approved(by): by',
        '    case Expired: "exp"',
        '    case Int as n: String(n)',
      ]),
    ).toBe('legal:exp:9');

    const twoEnums = ['enum First { Shared, OnlyFirst }', 'enum Second { Shared, OnlySecond }'];
    expect(
      runMain('String', 'pick(First.Shared) + ":" + pick(Second.Shared)', [
        ...twoEnums,
        'fn pick(x: First | Second) -> String:',
        '  match x:',
        '    case First.Shared: "f-shared"',
        '    case OnlyFirst: "f-only"',
        '    case Second.Shared: "s-shared"',
        '    case OnlySecond: "s-only"',
      ]),
    ).toBe('f-shared:s-shared');

    expect(
      codesOf(
        ...twoEnums,
        'fn bad(x: First | Second) -> Int:',
        '  match x:',
        '    case Shared: 1',
        '    case _: 0',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('matches generic union members bare when unique, and with type arguments when several instantiate the generic', () => {
    expect(
      runMain(
        'String',
        'oneGeneric(Box{value: 3}) + ":" + twoGenerics(Box{value: 4}) + ":" + twoGenerics(Box{value: "hi"})',
        [
          ...matchDecls,
          'fn oneGeneric(x: Box<Int> | String) -> String:',
          '  match x:',
          '    case Box{value}: String(value)',
          '    case String as s: s',
          'fn twoGenerics(x: Box<Int> | Box<String>) -> String:',
          '  match x:',
          '    case Box<Int>{value}: `int:${value}`',
          '    case Box<String>{value}: `str:${value}`',
        ],
      ),
    ).toBe('3:int:4:str:hi');

    expect(
      codesOf(
        ...matchDecls,
        'fn ambiguousGeneric(x: Box<Int> | Box<String>) -> Int:',
        '  match x:',
        '    case Box{value}: 1',
        '    case _: 0',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('selects shape members by field or alias, and reports an error when several member shapes have the fields', () => {
    expect(
      runMain(
        'String',
        'byField(struct{a: 5}) + ":" + byField(struct{b: "ok"}) + ":" + byAlias(struct{x: 1, y: 2})',
        [
          'type Point = { x: Int, y: Int }',
          'fn byField(x: { a: Int } | { b: String }) -> String:',
          '  match x:',
          '    case struct{a}: String(a)',
          '    case struct{b}: b',
          'fn byAlias(x: Point | Int) -> String:',
          '  match x:',
          '    case Point as p: String(p.x + p.y)',
          '    case Int as n: String(n)',
        ],
      ),
    ).toBe('5:ok:3');

    expect(
      codesOf(
        'fn ambiguousShape(x: { id: Int, a: Int } | { id: Int, b: String }) -> Int:',
        '  match x:',
        '    case struct{id}: id',
        '    case _: 0',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('narrows the remaining type after unguarded cases only, and binds a union on `A | B as x`', () => {
    expect(
      hoverCodeAt(
        'fn f(x: Int | String | Bool) -> Int:',
        '  match x:',
        '    case Int | String as ‸u:',
        '      0',
        '    case b:',
        '      if b: 1 else: 0',
      ),
    ).toEqual(['(variable) u: Int | String']);

    expect(
      hoverCodeAt(
        'fn f(x: Int | String | Bool) -> Int:',
        '  match x:',
        '    case Int:',
        '      0',
        '    case ‸rest:',
        '      1',
      ),
    ).toEqual(['(variable) rest: String | Bool']);

    expect(
      codesOf(
        'fn guardedDoesNotNarrow(x: Int?, flag: Bool) -> Int:',
        '  match x:',
        '    case None if flag: 0',
        '    case v: v + 1',
      ),
    ).toEqual([checkerDiagnostics.operatorTypes.code]);
  });

  it('checks exhaustiveness on unions and literal unions without `case _`', () => {
    expect(
      codesOf(
        'type Status = "draft" | "sent" | "failed"',
        'fn incomplete(s: Status) -> Int:',
        '  match s:',
        '    case "draft": 1',
        '    case "sent": 2',
      ),
    ).toEqual([checkerDiagnostics.nonExhaustiveMatch.code]);

    expect(
      codesOf(
        'fn incompleteUnion(x: Int | String | Bool) -> Int:',
        '  match x:',
        '    case Int: 1',
        '    case String: 2',
      ),
    ).toEqual([checkerDiagnostics.nonExhaustiveMatch.code]);
  });
});

/** Atomic members with disjoint constructor sets for property-testing union exhaustiveness. */
interface MemberSpec {
  readonly type: string;
  readonly fullCase: string;
  readonly partialCase?: string;
}

const memberSpecs: MemberSpec[] = [
  { type: 'Int', fullCase: 'case Int: 1', partialCase: 'case 0: 1' },
  { type: 'String', fullCase: 'case String: 2', partialCase: 'case "x": 2' },
  { type: 'Bool', fullCase: 'case true | false: 3', partialCase: 'case true: 3' },
  { type: 'None', fullCase: 'case None: 4' },
  { type: 'Email', fullCase: 'case Email: 5' },
  { type: '"draft"', fullCase: 'case "draft": 6' },
  { type: '42', fullCase: 'case 42: 7' },
];

describe('fast-check properties: union exhaustiveness and collapse (note 12)', () => {
  it('accepts a match without `case _` iff every normalized union member is covered', () => {
    const subsetArbitrary = fc
      .subarray(memberSpecs, { minLength: 1, maxLength: 5 })
      .filter(
        (members) =>
          !(
            (members.some((m) => m.type === 'String') &&
              members.some((m) => m.type === '"draft"')) ||
            (members.some((m) => m.type === 'Int') && members.some((m) => m.type === '42'))
          ),
      );

    fc.assert(
      fc.property(subsetArbitrary, fc.nat(10), (members, dropIndex) => {
        const unionText = members.map((m) => m.type).join(' | ');
        const completeCases = members.map((m) => `    ${m.fullCase}`).join('\n');
        const completeSource = [
          'struct Email { to: String }',
          `fn checkAll(x: ${unionText}) -> Int:`,
          '  match x:',
          completeCases,
        ].join('\n');
        expect(reported(completeSource).codes).toEqual([]);

        const dropped = dropIndex % members.length;
        const target = members[dropped];
        const incompleteCases = members
          .flatMap((m, idx) => {
            if (idx !== dropped) {
              return [`    ${m.fullCase}`];
            }
            return target?.partialCase === undefined ? [] : [`    ${target.partialCase}`];
          })
          .join('\n');
        const incompleteSource = [
          'struct Email { to: String }',
          `fn checkSome(x: ${unionText}) -> Int:`,
          '  match x:',
          incompleteCases,
        ].join('\n');
        const incompleteCodes =
          incompleteCases.length === 0
            ? [checkerDiagnostics.nonExhaustiveMatch.code]
            : reported(incompleteSource).codes;
        expect(incompleteCodes).toContain(checkerDiagnostics.nonExhaustiveMatch.code);
      }),
      { numRuns: 35 },
    );
  });

  it('keeps the first matching arm when a union collapses after substitution, without unreachable warnings', () => {
    const concreteTypes = fc.constantFrom(
      { type: 'Int', value: '7', tag: 'int' },
      { type: 'String', value: '"hi"', tag: 'str' },
      { type: 'Bool', value: 'true', tag: 'bool' },
    );

    fc.assert(
      fc.property(concreteTypes, fc.boolean(), ({ type, value, tag }, genericFirst) => {
        const boxCases = genericFirst
          ? [
              `    case Box<T>{value}: "first:${tag}"`,
              `    case Box<${type}>{value}: "second:${tag}"`,
            ]
          : [
              `    case Box<${type}>{value}: "first:${tag}"`,
              `    case Box<T>{value}: "second:${tag}"`,
            ];
        const decls = [
          'struct Box<V> { value: V }',
          `fn collapsed<T>(x: T | ${type}) -> String:`,
          '  match x:',
          `    case ${type}: "matched:${tag}"`,
          `    case _: "fallback:${tag}"`,
          `fn boxed<T>(x: Box<T> | Box<${type}>) -> String:`,
          '  match x:',
          ...boxCases,
        ];
        const diag = reported(
          [
            ...decls,
            `fn call() -> String: collapsed<${type}>(${value}) + ":" + boxed<${type}>(Box{value: ${value}})`,
          ].join('\n'),
        );
        expect(diag.codes).not.toContain(checkerDiagnostics.unreachableCase.code);
        expect(diag.codes).toEqual([]);
        expect(
          runMain(
            'String',
            `collapsed<${type}>(${value}) + ":" + boxed<${type}>(Box{value: ${value}})`,
            decls,
          ),
        ).toBe(`matched:${tag}:first:${tag}`);
      }),
      { numRuns: 20 },
    );
  });
});
