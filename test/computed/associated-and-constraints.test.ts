/**
 * Associated types and struct constraints (docs/proposals/4-computed-types.md §1, §2):
 * struct/enum/trait associated types (`type Name = Type`, `type Name is Constraint`), bare
 * cross-references among associated types and fields, reading `Type.Name` and `Self.Name`, static
 * calls through `Type.Name` and `T.Name`, opaque `T.Name` on constrained type parameters, object
 * safety (`Self.Name` counts as `Self`), non-inference through `Type.Name`, contextual `type: X`,
 * all forms of struct constraints (`struct`, `struct { [_] is X }`, named entries, open matching,
 * nested constraints), reading/writing constrained fields, and invalid cases.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import {
  codesOf,
  compareWrittenTypes,
  resolveWrittenTypes,
  runMain,
  sameComputedType,
  spelledTypeOf,
} from './computed.test-kit.ts';

const assocDecls = [
  "import Encodable from 'json'",
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'trait Keyed:',
  '  type Key is Stringable & Encodable',
  '  fn key(self: Self) -> Self.Key',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>:',
  '  if self.value == none: ["missing"] else: []',
  'struct Cell<T> { value: T, type Data = T }',
  'enum Outcome<T>:',
  '  type Payload = T',
  '  type Tag = "ok" | "err"',
  '  Done(value: Payload, tag: Tag)',
  '  Failed(reason: String)',
];

describe('associated types on structs, enums, and traits (§1)', () => {
  it('declares associated types in structs (indented or braced) and enums, in any order, usable bare by fields and sibling associated types', async () => {
    const decls = [
      ...assocDecls,
      'struct Ordered<T>:',
      '  first: Pair',
      '  type Pair = (Item, Item)',
      '  type Item = T',
      '  second: Item',
    ];
    expect(compareWrittenTypes('Field<String>.Data', 'String', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Cell<Int>.Data', 'Int', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Outcome<Bool>.Payload', 'Bool', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Outcome<Bool>.Tag', '"ok" | "err"', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('Ordered<Int>.Pair', '(Int, Int)', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Ordered<Int>.Item', 'Int', decls)).toEqual(sameComputedType);

    expect(
      await runMain(
        'Int',
        [
          'const o = Ordered<Int>{first: (3, 4), second: 5}',
          'const d: Outcome<Int> = Done(value: 10, tag: "ok")',
          'const v = match d:',
          '  case Done(value: value, ...): value',
          '  case _: 0',
          'o.first.0 + o.first.1 + o.second + v',
        ].join('\n  '),
        decls,
      ),
    ).toBe(22);
  });

  it('keeps `type` contextual so `type: X` is still a field named `type` beside `type Data = T`', async () => {
    const decls = ['struct Token<T>:', '  type: String', '  type Data = T', '  payload: Data'];
    expect(compareWrittenTypes('Token<Int>.Data', 'Int', decls)).toEqual(sameComputedType);
    expect(
      await runMain(
        'String',
        'const t = Token<Int>{type: "bearer", payload: 7}\n  `${t.type}:${t.payload}`',
        decls,
      ),
    ).toBe('bearer:7');
  });

  it('substitutes `Type.Name` on generic types (including open type parameters) and chains `A.B.C`', async () => {
    const decls = [
      ...assocDecls,
      'struct Outer<T>:',
      '  type Inner = Field<Array<T>>',
      'fn echo<T>(x: Outer<T>.Inner.Data) -> Array<T>: x',
    ];
    expect(compareWrittenTypes('Outer<Int>.Inner.Data', 'Array<Int>', decls)).toEqual(
      sameComputedType,
    );
    expect(await runMain('Int', 'echo<Int>([10, 20]).length()', decls)).toBe(2);
  });

  it('calls static functions through `Type.Name` and constrained `T.Name`', async () => {
    // No primitive meets `Default` (prelude), and a witness is declared beside its type or trait
    // (§3.10), so the bound is met by a type of this module.
    const decls = [
      'trait HasDefaultData:',
      '  type Data is Default & Parsable',
      'struct Count { n: Int }',
      'fn Count.default() -> Count: Count{n: 1}',
      'fn Count.parse(text: String) -> Result<Count>: Ok(Count{n: text.length()})',
      'struct IntHolder:',
      '  type Data = Int',
      'struct CountHolder:',
      '  type Data = Count',
      'fn makeDefault<H is HasDefaultData>() -> H.Data:',
      '  H.Data.default()',
      'fn parseFrom<H is HasDefaultData>(s: String) -> Result<H.Data>:',
      '  H.Data.parse(s)',
    ];
    expect(
      await runMain(
        'Int',
        [
          'const direct = match IntHolder.Data.parse("39"):',
          '  case Ok(value): value',
          '  case _: 0',
          'const viaTrait = match parseFrom<CountHolder>("ab"):',
          '  case Ok(value): value.n',
          '  case _: 0',
          'direct + viaTrait + makeDefault<CountHolder>().n',
        ].join('\n  '),
        decls,
      ),
    ).toBe(42);
  });

  it('treats `T.Data` on a constrained type parameter as opaque, equal only to itself and meeting its bound', async () => {
    const decls = [
      ...assocDecls,
      'struct User { id: Int, type Key = Int }',
      'fn key(self: User) -> Int: self.id',
      'fn sameOpaque<A is Keyed>(x: A.Key) -> A.Key: x',
      'fn formatKey<A is Keyed>(item: A) -> String: `${item.key()}`',
    ];
    expect(await runMain('String', 'formatKey(User{id: 99})', decls)).toBe('99');

    expect(
      codesOf(...assocDecls, 'fn mismatchOpaque<A is Keyed, B is Keyed>(x: A.Key) -> B.Key: x'),
    ).toEqual([checkerDiagnostics.typeMismatch.code]);

    expect(codesOf(...assocDecls, 'fn concreteOpaque<A is Keyed>(x: A.Key) -> String: x')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);
  });

  it('substitutes `Self.Name` with the implementing type’s associated type when meeting trait requirements', async () => {
    const decls = [
      ...assocDecls,
      'fn runNode<N is FormNode>(node: N, data: N.Data) -> Array<String>:',
      '  node.validate(data)',
    ];
    expect(
      await runMain(
        'String',
        [
          'const a = runNode(Field<Int>{value: 5}, 5)',
          'const b = runNode(Field<Int>{value: none}, 5)',
          '`${a.length()}:${b[0]}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('0:missing');
  });

  it('counts `Self.Name` as `Self` for object safety (`any` and union member conformance)', async () => {
    const decls = [
      ...assocDecls,
      'trait SafeWithAssoc:',
      '  type Meta',
      '  fn label(self: Self) -> String',
      'struct A { type Meta = Int }',
      'struct B { type Meta = String }',
      'fn label(self: A) -> String: "a"',
      'fn label(self: B) -> String: "b"',
    ];
    // `FormNode` uses `Self.Data` in a non-receiver parameter, and `Keyed` returns `Self.Key`:
    // neither can follow `any` nor be met by a union through its members.
    expect(codesOf(...decls, 'fn badAny1(x: any FormNode): ()')).toContain(
      checkerDiagnostics.notObjectSafe.code,
    );
    expect(codesOf(...decls, 'fn badAny2(x: any Keyed): ()')).toContain(
      checkerDiagnostics.notObjectSafe.code,
    );
    expect(
      codesOf(
        ...decls,
        'fn needForm<T is FormNode>(x: T): ()',
        'fn badUnion(u: Field<Int> | Field<String>): needForm(u)',
      ),
    ).toContain(checkerDiagnostics.notConforming.code);

    // `SafeWithAssoc` declares `type Meta` but never uses `Self.Meta` in its function signatures:
    expect(
      await runMain(
        'String',
        'const x: any SafeWithAssoc = A\n  const u: A | B = B\n  `${x.label()}:${u.label()}`',
        decls,
      ),
    ).toBe('a:b');
  });

  it('never infers a type parameter through an associated type `Field<T>.Data`', async () => {
    const decls = [
      ...assocDecls,
      'fn onlyAssoc<T>(x: Field<T>.Data) -> T: x',
      'fn withOther<T>(f: Field<T>, x: Field<T>.Data) -> T: x',
    ];
    // A result expected of the call would give `T` itself, so none is.
    expect(codesOf(...decls, 'fn bad(): _ = onlyAssoc(42)')).toEqual([
      checkerDiagnostics.cannotInfer.code,
    ]);
    expect(await runMain('Int', 'onlyAssoc<Int>(10) + withOther(Field{value: 1}, 32)', decls)).toBe(
      42,
    );
  });

  it('rejects invalid associated type declarations and uses', () => {
    // Self-referential associated type
    expect(codesOf('struct Cyc { type A = A }').length).toBeGreaterThan(0);
    // Mutual cycle between associated types
    expect(codesOf('struct Mutual { type A = B, type B = A }').length).toBeGreaterThan(0);
    // Associated type clashing with an enum variant name
    expect(codesOf('enum Clash { Red, type Red = Int }').length).toBeGreaterThan(0);
    // Associated type with type parameters
    expect(codesOf('struct GenericAssoc { type Box<T> = Array<T> }').length).toBeGreaterThan(0);
    // Associated type on an anonymous struct type
    expect(codesOf('type BadShape = { x: Int, type Data = Int }').length).toBeGreaterThan(0);
    // Reading an associated type on a shape, union, extern struct, or primitive
    expect(
      codesOf(
        'extern struct HostBox',
        'type Shape = { a: Int }',
        'fn bad(a: Shape.Data, b: (Int | String).Data, c: HostBox.Data, d: Int.Data): ()',
      ).length,
    ).toBeGreaterThanOrEqual(4);
    // Missing associated type or failing its trait bound when meeting a trait
    expect(
      codesOf(
        ...assocDecls,
        'struct NoKey { id: Int }',
        'fn key(self: NoKey) -> Int: self.id',
        'struct BadKey { s: Slot<Int>, type Key = Slot<Int> }',
        'fn key(self: BadKey) -> Slot<Int>: self.s',
        'fn useKey<T is Keyed>(x: T): ()',
        'fn test(a: NoKey, b: BadKey):',
        '  useKey(a)',
        '  useKey(b)',
      ),
    ).toEqual([checkerDiagnostics.notConforming.code, checkerDiagnostics.notConforming.code]);
  });
});

describe('struct constraints (§2)', () => {
  const constraintDecls = [
    ...assocDecls,
    'struct Empty',
    'struct NamedOnly { title: String, count: Int }',
    'struct FormWithTitle { title: String, age: Field<Int>, name: Field<String> }',
    'struct IntFields { a: Int, b: Int }',
    'shared struct SharedCounter { title: String }',
    'extern struct HostStruct',
    'enum Choice { One, Two }',
    'fn anyStruct<S is struct>(s: S) -> Int: 1',
    'fn allFormNodes<S is struct { [_] is FormNode }>(s: S) -> Int: 2',
    'fn titleAndNodes<S is struct { title: String, [_] is FormNode }>(s: S) -> String: s.title',
    'fn hasTitle<S is struct { title: String }>(s: S) -> String: s.title',
    'fn allInts<S is struct { [_]: Int }>(s: S) -> Int: 5',
  ];

  it('accepts nominal structs and shapes meeting each row of §2’s table, including open extra fields', async () => {
    expect(
      await runMain(
        'String',
        [
          'const c1 = anyStruct(Empty) + anyStruct(struct{x: 1})',
          'const c2 = allFormNodes(struct{a: Field<Int>{value: 1}, b: Field<String>{value: "hi"}})',
          'const c3 = titleAndNodes(FormWithTitle{title: "order", age: Field{value: 20}, name: Field{value: "Ada"}})',
          'const c4 = hasTitle(NamedOnly{title: "doc", count: 3}) + ":" + hasTitle(struct{title: "shape", extra: true})',
          'const c5 = allInts(IntFields{a: 1, b: 2}) + allInts(struct{x: 10})',
          '`${c1}|${c2}|${c3}|${c4}|${c5}`',
        ].join('\n  '),
        constraintDecls,
      ),
    ).toBe('2|2|order|doc:shape|10');
  });

  it('supports reading and writing named fields on a constrained type parameter, nested struct constraints, and `&` inside and outside braces', async () => {
    const decls = [
      ...assocDecls,
      'fn renameTitle<S is struct { title: String, meta is struct { tag: String }, [_] is FormNode & Sendable } & Sendable>(form: &S, next: String) -> String:',
      '  const old = form.title + ":" + form.meta.tag',
      '  form.title = next',
      '  old',
    ];
    expect(
      await runMain(
        'String',
        [
          'let form = struct{title: "v1", meta: struct{tag: "draft", rev: 1}, f: Field<Int>{value: 3}}',
          'const before = renameTitle(&form, "v2")',
          '`${before}->${form.title}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('v1:draft->v2');
  });

  it('rejects non-structs (shared struct, extern struct, enum, tuple, union, primitive) and structs with non-conforming fields', () => {
    expect(
      codesOf(
        ...constraintDecls,
        'fn badTypes(sh: SharedCounter, h: HostStruct, e: Choice, t: (Int, Int), u: NamedOnly | IntFields, n: Int):',
        '  _ = anyStruct(sh)',
        '  _ = anyStruct(h)',
        '  _ = anyStruct(e)',
        '  _ = anyStruct(t)',
        '  _ = anyStruct(u)',
        '  _ = anyStruct(n)',
      ),
    ).toEqual([
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
    ]);

    expect(
      codesOf(
        ...constraintDecls,
        'fn badFields():',
        '  _ = allFormNodes(struct{note: "plain string"})',
        '  _ = titleAndNodes(struct{title: 123, f: Field<Int>{value: 1}})',
        '  _ = allInts(struct{a: 1, b: "two"})',
      ),
    ).toEqual([
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.unmetStructConstraint.code,
    ]);
  });

  it('refuses accessing unstated fields on a constrained type parameter, struct constraints in type position or after `any`, and two `[_]` entries', () => {
    expect(codesOf('fn readUnknown<S is struct { title: String }>(s: S) -> Int: s.other')).toEqual([
      checkerDiagnostics.unknownField.code,
    ]);

    // Struct constraint where a type is expected, or after `any`, or with two `[_]` entries:
    expect(codesOf('fn badTypePos(x: struct): ()').length).toBeGreaterThan(0);
    expect(codesOf('fn badTypePos2(x: struct { [_]: Int }): ()').length).toBeGreaterThan(0);
    expect(codesOf('fn badAny(x: any struct { title: String }): ()').length).toBeGreaterThan(0);
    expect(
      codesOf('fn badTwoWildcards<S is struct { [_]: Int, [_]: Int }>(s: S): ()').length,
    ).toBeGreaterThan(0);
  });

  it('resolves aliases in `name: Type` entries of a struct constraint', async () => {
    const decls = [
      'type Label = String',
      'fn readLabel<S is struct { name: Label }>(s: S) -> String: s.name',
    ];
    expect(spelledTypeOf('Label', decls)).toBe('Label');
    expect(resolveWrittenTypes(['{ name: String }'], decls).diagnosticCodes).toEqual([]);
    expect(await runMain('String', 'readLabel(struct{name: "ok", extra: 1})', decls)).toBe('ok');
  });
});
