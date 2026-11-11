/**
 * Using unions, JSON codecs, member type parameters (`T in U`), extern keys, and LSP/formatter
 * support (docs/proposals/3-union-types.md §6, §7, notes 6–11): direct member access refusal,
 * trait conformance and dispatch through visible object-safe traits, overload resolution and
 * clashes, `==` and map keys, sendability and must-use, JSON codecs for `T | None` and literal
 * unions, `<T in U>` inference and instantiation, `prelude.Optional<T>` extern keys, hover,
 * completion, and canonical formatting.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { formatText } from '../../src/formatter/format.ts';
import {
  codesOf,
  completionNamesAt,
  definitionOf,
  hoverCodeAt,
  runMain,
} from './unions.test-kit.ts';

const commonDecls = [
  'type Status = "draft" | "sent" | "failed"',
  'struct Email { to: String }',
  'struct Sms { number: String }',
  'type Contact = Email | Sms',
  'trait Notifier:',
  '  fn send(self: Self, text: String) -> String',
  'fn send(self: Email, text: String) -> String: `mail(${self.to}):${text}`',
  'fn send(self: Sms, text: String) -> String: `sms(${self.number}):${text}`',
  'fn toString(self: Email) -> String: `Email(${self.to})`',
  'fn toString(self: Sms) -> String: `Sms(${self.number})`',
];

describe('using a union: traits, overloads, clashes, equality, sendability, must-use (§6)', () => {
  it('refuses direct member fields, methods, or operators not in a visible trait', () => {
    expect(
      codesOf(
        ...commonDecls,
        'fn badField(c: Contact) -> String: c.to',
        'fn badOp(x: Int | String) -> Int: x + 1',
      ),
    ).toEqual([checkerDiagnostics.unknownField.code, checkerDiagnostics.operatorTypes.code]);
  });

  it('dispatches calls on a union through visible object-safe traits, and meets generic and `any` bounds', async () => {
    expect(
      await runMain(
        'String',
        [
          'const c1: Contact = Email{to: "cfo"}',
          'const c2: Contact = Sms{number: "555"}',
          'const x: Int | Email = 42',
          'const y: Int | Email = Email{to: "ops"}',
          'const anyStr: any Stringable = y',
          'const defOpt: Int? = optDefault<Int?>()',
          '`${c1.send("hi")}|${c2.send("yo")}|${x.toString()}|${y}|${showGen(x)}|${String(anyStr)}|${defOpt ?? -1}`',
        ].join('\n  '),
        [
          ...commonDecls,
          'fn showGen<T is Stringable>(v: T) -> String: v.toString()',
          'fn optDefault<T is Default>() -> T: T.default()',
        ],
      ),
    ).toBe('mail(cfo):hi|sms(555):yo|42|Email(ops)|42|Email(ops)|-1');
  });

  it('infers the arguments of a trait nothing names from a call on a union, refusing those a member does not meet', async () => {
    const decls = [
      'trait Feeds<F>:',
      '  fn feed(self: Self, food: F) -> String',
      'trait Makes<T>:',
      '  fn make(self: Self) -> T',
      'struct Cat { name: String }',
      'struct Dog { name: String }',
      'fn feed(self: Cat, food: Int) -> String: `${self.name}:${food}`',
      'fn feed(self: Dog, food: Int) -> String: `${self.name}+${food}`',
      'fn make(self: Cat) -> Int: 1',
      'fn make(self: Dog) -> Int: 2',
    ];
    expect(
      await runMain(
        'String',
        [
          'const a: Cat | Dog = Cat{name: "c"}',
          'const b: Cat | Dog = Dog{name: "d"}',
          'const made: Int = b.make()',
          '`${a.feed(3)}|${b.feed(4)}|${made}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('c:3|d+4|2');
    expect(codesOf(...decls, 'fn bad(x: Cat | Dog) -> String: x.feed("bone")')).toEqual([
      checkerDiagnostics.notConforming.code,
    ]);
    expect(codesOf(...decls, 'fn open(x: Cat | Dog):', '  _ = x.make()')).toEqual([
      checkerDiagnostics.cannotInfer.code,
    ]);
  });

  it('refuses non-object-safe traits (static requirements, second Self) on a union without a declared union witness', () => {
    expect(
      codesOf(
        'fn needDefault<T is Default>() -> T: T.default()',
        'fn needComparable<T is Comparable>(a: T, b: T) -> Int: compare(a, b)',
        'fn bad(x: Int | String):',
        '  _ = needDefault<Int | String>()',
        '  _ = needComparable(x, x)',
      ),
    ).toEqual([checkerDiagnostics.notConforming.code, checkerDiagnostics.notConforming.code]);
  });

  it('refuses a trait call on a union when several visible traits provide the method', () => {
    expect(
      codesOf(
        'trait A:',
        '  fn act(self: Self) -> Int',
        'trait B:',
        '  fn act(self: Self) -> Int',
        'struct One { n: Int }',
        'struct Two { n: Int }',
        'fn act(self: One) -> Int: self.n',
        'fn act(self: Two) -> Int: self.n',
        'fn bad(x: One | Two) -> Int: x.act()',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('enforces union overload resolution, choosing the most specific of overloads', async () => {
    expect(
      codesOf(
        'fn f(x: Int) -> Int: x',
        'fn f(x: String) -> Int: x.length()',
        'fn bad(u: Int | String) -> Int: f(u)',
      ),
    ).toEqual([checkerDiagnostics.noMatchingOverload.code]);

    const overloads = [
      'fn g(x: Int) -> Int: x',
      'fn g(x: Int | String) -> Int: 0',
      'fn h(x: "a") -> Int: 1',
      'fn h(x: String) -> Int: 2',
      'fn k(x: "a") -> Int: 1',
      'fn k(x: "a" | "b") -> Int: 2',
    ];
    expect(codesOf(...overloads)).toEqual([]);
    expect(
      await runMain(
        'String',
        '`${g(1)}:${g("x")}:${h("a")}:${h("b")}:${k("a")}:${k("b")}`',
        overloads,
      ),
    ).toBe('1:0:1:2:1:2');
  });

  it('compares union values by member type then value, allows unions as Map keys, and checks Sendable and must-use', async () => {
    expect(
      await runMain(
        'String',
        [
          'const a: Int | String = 1',
          'const b: Int | String = "1"',
          'const c: Int | String = 1',
          'const m: Map<Int | String, String> = [a: "num", b: "str"]',
          '`${a == c}:${a == b}:${m[1]}:${m["1"]}`',
        ].join('\n  '),
      ),
    ).toBe('true:false:num:str');

    expect(
      codesOf(
        'fn needSendable<T is Sendable>(x: T): ()',
        'ista fn badSendable(x: Int | Slot<Int>): needSendable(x)',
      ),
    ).toEqual([checkerDiagnostics.notConforming.code]);

    expect(
      codesOf(
        'fn makeMustUse(x: Result<Int> | Int) -> Result<Int> | Int: x',
        'fn badUnused(x: Result<Int> | Int):',
        '  makeMustUse(x)',
        '  return',
      ),
    ).toEqual([checkerDiagnostics.unusedValue.code]);
  });
});

describe('JSON codecs for `T | None`, `T??`, and literal unions (§6, §9)', () => {
  it('encodes and decodes `T | None`, collapsed `T??`, and literal unions, refusing invalid literals', async () => {
    expect(
      await runMain(
        'String',
        [
          'const s1: Status = "sent"',
          'const j1 = json.stringify(s1)',
          'const p1 = match json.parse<Status>(\'"draft"\'):',
          '  case Ok(value): value',
          '  case Err(error): "err"',
          'const pBad = match json.parse<Status>(\'"archived"\'):',
          '  case Ok(value): value',
          '  case Err(error): "err"',
          'const n1: 1 | -1 | 42 = -1',
          'const j2 = json.stringify(n1)',
          'const p2 = match json.parse<1 | -1 | 42>("42"):',
          '  case Ok(value): value',
          '  case Err(error): 0',
          'const p2Bad = match json.parse<1 | -1 | 42>("99"):',
          '  case Ok(value): value',
          '  case Err(error): 0',
          'const optLit: Status? = none',
          'const nestedOpt: Int?? = 7',
          '`${j1}|${p1}|${pBad}|${j2}|${p2}|${p2Bad}|${json.stringify(optLit)}|${json.stringify(nestedOpt)}`',
        ].join('\n  '),
        ["import * as json from 'json'", ...commonDecls],
      ),
    ).toBe('"sent"|draft|err|-1|42|0|null|7');
  });

  it('encodes `None` itself, which a `none` leaves no `T?` to fill, as null', async () => {
    expect(
      await runMain(
        'String',
        'const n: None = none\n  `${json.stringify(n)}|${json.stringify(Holder{n: none})}`',
        ["import * as json from 'json'", 'struct Holder { n: None }'],
      ),
    ).toBe('null|{"n":null}');
  });

  it('refuses non-optional, non-literal unions as Encodable or Decodable', () => {
    expect(
      codesOf(
        "import * as json from 'json'",
        ...commonDecls,
        'fn bad(u: Int | String, c: Contact):',
        '  _ = json.stringify(u)',
        '  _ = json.stringify(c)',
        '  _ = json.parse<Int | String>("1")',
      ),
    ).toEqual([
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
    ]);
  });
});

describe('member type parameters `T in U` (§7)', () => {
  it('infers a single member from a literal or narrowed member, instantiates per member, and builds Entry from expected union', async () => {
    const memberDecls = [
      ...commonDecls,
      'fn describeStatus<S in Status>(s: S) -> String: `status:${s}`',
      'struct Entry<V, K in Status> { key: K, value: V }',
      'type AnyEntry = Entry<Int, "draft"> | Entry<String, "sent">',
    ];
    expect(
      await runMain(
        'String',
        [
          'const d1 = describeStatus("draft")',
          'const st: Status = "sent"',
          'const d2 = match st:',
          '  case "sent" as s: describeStatus(s)',
          '  case _: "other"',
          'const e1: AnyEntry = Entry{key: "draft", value: 10}',
          'const e2: AnyEntry = Entry{key: "sent", value: "ok"}',
          'fn showEntry(e: AnyEntry) -> String:',
          '  match e:',
          '    case Entry<Int, "draft">{value}: `d:${value}`',
          '    case Entry<String, "sent">{value}: `s:${value}`',
          '`${d1}|${d2}|${showEntry(e1)}|${showEntry(e2)}`',
        ].join('\n  '),
        memberDecls,
      ),
    ).toBe('status:draft|status:sent|d:10|s:ok');
  });

  it('refuses a multi-member union argument for a `T in U` type parameter', () => {
    expect(
      codesOf(
        ...commonDecls,
        'fn describeStatus<S in Status>(s: S) -> String: s',
        'fn bad(s: Status) -> String: describeStatus(s)',
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('extern keys, hover, completion, and formatter (notes 8, 10, 11)', () => {
  it('keeps `prelude.Optional<T>` in extern keys for `T?` and `T | None`', () => {
    const def = definitionOf(
      'extern fn poll(id: String | None) -> Int?',
      "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
      '  poll("x") ?? 0',
    );
    const externs = def.functions.flatMap((fn) => (fn.kind === 'extern' ? [fn.key] : []));
    expect(externs).toContain('main.poll(prelude.Optional<String>)');
  });

  it('shows union, literal, and None types in hover, offers union completions, and round-trips formatting', () => {
    expect(
      hoverCodeAt(
        'type Status = "draft" | "sent"',
        'fn f(x: Int | String, s: Status):',
        '  const ‸u = x',
        '  _ = (u, s)',
      ),
    ).toEqual(['(variable) u: Int | String']);

    const patternOffered = completionNamesAt(
      'type Status = "draft" | "sent"',
      'struct Email { to: String }',
      'fn f(x: Email | Int?) -> Int:',
      '  match x:',
      '    case ‸',
      '  0',
    );
    expect(patternOffered).toEqual(expect.arrayContaining(['Email', 'Int', 'None']));

    const methodOffered = completionNamesAt(
      'struct Email { to: String }',
      'fn toString(self: Email) -> String: self.to',
      'fn f(x: Int | Email) -> String:',
      '  x.‸',
    );
    expect(methodOffered).toContain('toString');

    const source = [
      'type Status = "draft" | "sent" | -1 | true\n',
      'fn f<S in Status>(s: S, g: (fn(Int) -> Int) | String) -> Int | String:\n',
      '  s\n',
    ].join('');
    const formatted = formatText(source);
    expect(formatted).toBeDefined();
    expect(formatted === undefined ? undefined : formatText(formatted)).toBe(formatted);
  });
});
