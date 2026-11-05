/**
 * Mapped struct types (docs/proposals/4-computed-types.md §3): `{ [F in keyof S]: T }` and
 * `{ [K in "a" | "b"]: T }`, named entries before and after the mapped entry and skipping the keys
 * they name, the key as a literal type and `S[F]` as the field's type inside `T`, identity as a
 * shape, a nominal struct converted into an equal mapped shape, JSON codecs, and invalid mapped
 * types.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, compareWrittenTypes, runMain, sameComputedType } from './computed.test-kit.ts';

const schemaDecls = [
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>: []',
  'struct Repeat<Row is FormNode>:',
  '  row: Row',
  '  type Data = Array<Row.Data>',
  'fn validate<R is FormNode>(self: Repeat<R>, data: Array<R.Data>) -> Array<String>: []',
  'struct Group<S is struct { [_] is FormNode }>:',
  '  fields: S',
  '  type Data = { [F in keyof S]: S[F].Data }',
  'fn validate<S is struct { [_] is FormNode }>(self: Group<S>, data: Group<S>.Data) -> Array<String>: []',
  'struct OrderForm:',
  '  country: Field<String>',
  '  items: Repeat<Group<{ sku: Field<String>, qty: Field<Int> }>>',
];

describe('mapped struct types (§3)', () => {
  it('maps over `keyof S` and literal unions, producing a shape equal to hand-written `{ … }` in any field order', () => {
    expect(
      compareWrittenTypes(
        'Group<OrderForm>.Data',
        '{ items: Array<{ qty: Int, sku: String }>, country: String }',
        schemaDecls,
      ),
    ).toEqual(sameComputedType);

    expect(
      compareWrittenTypes('{ [K in "retries" | "region"]: Int }', '{ region: Int, retries: Int }'),
    ).toEqual(sameComputedType);

    expect(compareWrittenTypes('{ [K in "only"]: Bool }', '{ only: Bool }')).toEqual(
      sameComputedType,
    );

    expect(compareWrittenTypes('{ [K in Never]: Int }', '{}')).toEqual(sameComputedType);
  });

  it('allows named entries before and after the mapped entry, skipping keys already named in the braces', () => {
    const decls = [
      ...schemaDecls,
      'struct WithTitle { title: String, count: Field<Int>, active: Field<Bool> }',
      // `title` in WithTitle is a plain String (not a FormNode), but naming `title: String` in the
      // braces skips `title` in `[F in keyof S]: S[F].Data`!
      'type MappedWithTitle<S is struct { title: String, [_] is FormNode }> = {',
      '  id: Int,',
      '  [F in keyof S]: S[F].Data,',
      '  title: String',
      '}',
    ];
    expect(
      compareWrittenTypes(
        'MappedWithTitle<WithTitle>',
        '{ id: Int, title: String, count: Int, active: Bool }',
        decls,
      ),
    ).toEqual(sameComputedType);
  });

  it('provides `K` as the field’s literal type and `S[F]` as the field’s type inside `T`', () => {
    const decls = [
      'struct Settings { retries: Int, region: String }',
      'type Tagged<S is struct> = { [F in keyof S]: (F, S[F]) }',
    ];
    expect(
      compareWrittenTypes(
        'Tagged<Settings>',
        '{ region: ("region", String), retries: ("retries", Int) }',
        decls,
      ),
    ).toEqual(sameComputedType);
  });

  it('converts a nominal struct into an equal mapped shape, drops defaults and annotations from `S`, and encodes/decodes as JSON', () => {
    const decls = [
      "import * as json from 'json'",
      'struct Annotated {',
      '  id: Int = 10 @json.JsonName{"custom_id"}',
      '  name: String = "anon"',
      '}',
      'struct Plain { id: Int, name: String }',
      'type Cloned = { [F in keyof Annotated]: Annotated[F] }',
      'fn takeCloned(c: Cloned) -> String: json.stringify(c)',
    ];
    // Nominal `Plain` converts to `Cloned`, and `@JsonName{"custom_id"}` was NOT carried over:
    expect(runMain('String', 'takeCloned(Plain{id: 1, name: "ada"})', decls)).toBe(
      '{"id":1,"name":"ada"}',
    );

    // Defaults from `Annotated` are NOT carried over to `Cloned`, so `struct{id: 1}` misses `name`:
    expect(codesOf(...decls, 'fn missingDefault() -> Cloned: struct{id: 1}')).toEqual([
      checkerDiagnostics.missingField.code,
    ]);
  });

  it('rejects invalid mapped struct types', () => {
    // Non-struct in `keyof`
    expect(codesOf('type Bad1 = { [K in keyof Int]: Int }').length).toBeGreaterThan(0);
    // Non-String-literal domain in `[K in U]`
    expect(codesOf('type Bad2 = { [K in Int]: String }').length).toBeGreaterThan(0);
    expect(codesOf('type Bad3 = { [K in 1 | 2]: String }').length).toBeGreaterThan(0);
    // Invalid field name in literal union (not camelCase identifier)
    expect(codesOf('type Bad4 = { [K in "not-valid"]: Int }').length).toBeGreaterThan(0);
    expect(codesOf('type Bad5 = { [K in "PascalField"]: Int }').length).toBeGreaterThan(0);
    // Two mapped entries in one `{ … }`
    expect(codesOf('type Bad6 = { [A in "a"]: Int, [B in "b"]: Int }').length).toBeGreaterThan(0);
    // Constrained `S` where a named entry of the constraint isn't overridden and lacks `.Data`
    expect(
      codesOf(
        ...schemaDecls,
        'type Bad7<S is struct { title: String, [_] is FormNode }> = { [F in keyof S]: S[F].Data }',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the keys a mapped entry ranges over through substitution, so a generic mapped type checks writes by key', () => {
    const copy = [
      'type Copy<S is struct> = { [F in keyof S]: S[F] }',
      'type Labels<S is struct> = { [F in keyof S]: Entry<S, F> }',
      'struct Entry<S is struct, K in keyof S> { key: K }',
    ];
    const generic = (body: string, type = 'Copy<T>') => [
      ...copy,
      `fn g<T is struct { a: Int, [_]: String }>(x: ${type}, k: keyof T) -> ${type}:`,
      '  let y = x',
      `  ${body}`,
      '  y',
    ];
    const mismatch = new Set([checkerDiagnostics.typeMismatch.code]);
    expect(new Set(codesOf(...generic('y[k] = true')))).toEqual(mismatch);
    expect(new Set(codesOf(...generic('y[k] = true', 'Copy<Copy<T>>')))).toEqual(mismatch);
    expect(codesOf(...generic('y.a = 1'))).toEqual([]);
    expect(codesOf(...generic('y.a = Entry{key: "a"}', 'Labels<T>'))).toEqual([]);
    expect(codesOf(...generic('y.a = Entry{key: k}', 'Labels<T>')).length).toBeGreaterThan(0);
  });
});
