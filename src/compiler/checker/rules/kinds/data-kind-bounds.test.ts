/**
 * What generic code may hold of what its type parameters compute (proposal 8, Rule 3): an
 * associated type of a type not known yet has the kinds its bounds allow, `DataKind<"simple">`
 * where none is written; a type `match` has its cases' kinds. `DataKind<K>` is derived (§3.10), and
 * Sendable or a narrower `DataKind` implies it.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, liveResource, reportedMessages } from './kinds.test-kit.ts';

const codes = checkerDiagnostics;

/** A trait whose associated type is bounded `Default` and `bound`, and a type giving it live data. */
function liveData(bound = ''): readonly string[] {
  return [
    ...liveResource,
    `trait HasData { type Data is Default${bound} }`,
    'struct Box { type Data = LiveResource }',
  ];
}

/** A function of `head`'s mark holding its type parameter's associated type. */
function holdingData(head: string): readonly string[] {
  return [`${head} useData<T is HasData>() -> Int:`, '  const x = T.Data.default()', '  0'];
}

describe('an associated type of a type not known yet', () => {
  it.each([
    ['', 'no bound, which is `DataKind<"simple">`'],
    [' & DataKind<"simple">', 'a simple bound'],
  ])('is simple with %j, refusing a type giving it live data where it meets the trait', (bound) => {
    const source = [...liveData(bound), ...holdingData('fn')];
    expect(codesOf(...source)).toEqual([]);
    const { codes: found, messages } = reportedMessages(
      ...source,
      'ista async fn main() -> Int: useData<Box>()',
    );
    expect(found).toEqual([codes.notConforming.code]);
    expect(messages[0]).toContain('Box');
    expect(messages[0]).toContain('DataKind<"simple">');
  });

  it('may be live in live code when its bound allows it, which ista code may not call', () => {
    const source = [...liveData(' & DataKind<"live" | "simple">'), ...holdingData('live fn')];
    expect(codesOf(...source, 'live fn main() -> Int: useData<Box>()')).toEqual([]);
    const refused = reportedMessages(...source, 'ista fn main() -> Int: useData<Box>()');
    expect(refused.codes).toEqual([codes.kindsMeet.code]);
    expect(refused.messages[0]).toContain("'useData'");
    expect(codesOf(...liveData(' & DataKind<"live" | "simple">'), ...holdingData('fn'))).toEqual([
      codes.unmarkedHolds.code,
    ]);
  });

  it('is simple when bounded Sendable', () => {
    const source = ['trait HasData { type Data is Default & Sendable }', ...holdingData('fn')];
    expect(codesOf(...source)).toEqual([]);
  });
});

describe('a type match of types not known yet', () => {
  it("is of its cases' kinds", () => {
    const source = [
      ...liveResource,
      'type PickResource<T> = match T:',
      '  case Int: LiveResource',
      '  case _: Int',
      'fn holdPicked<T>() -> Int:',
      '  const x: PickResource<T>? = none',
      '  0',
    ];
    expect(codesOf(...source, 'ista async fn main() -> Int: holdPicked<Int>()')).toEqual([
      codes.unmarkedHolds.code,
    ]);
  });

  it('passes through what a case takes from its subject', () => {
    const source = [
      'type Same<T> = match T:',
      '  case Int: Int',
      '  case _: T',
      'fn holdSame<T>() -> Int:',
      '  const x: Same<T>? = none',
      '  0',
    ];
    expect(codesOf(...source)).toEqual([]);
  });
});

describe('meeting DataKind', () => {
  const needs = (marks: string) => `fn need<U is DataKind<${marks}>>() -> Int: 0`;

  it('is met by a type whose kind is among its marks, simple where it holds none', () => {
    expect(codesOf(...liveResource, needs('"simple"'), 'fn main() -> Int: need<Int>()')).toEqual(
      [],
    );
    expect(
      codesOf(...liveResource, needs('"live"'), 'live fn main() -> Int: need<LiveResource>()'),
    ).toEqual([]);
    const { messages } = reportedMessages(
      ...liveResource,
      needs('"simple"'),
      'live fn main() -> Int: need<LiveResource>()',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"simple"');
  });

  it("is met by a type parameter whose bounds' marks it holds, Sendable's being simple", () => {
    const passing = (bound: string) => `fn pass<V is ${bound}>() -> Int: need<V>()`;
    expect(codesOf(needs('"simple"'), passing('Sendable'))).toEqual([]);
    expect(codesOf(needs('"live" | "simple"'), passing('DataKind<"live">'))).toEqual([]);
    expect(codesOf(needs('"live"'), passing('DataKind<"live" | "simple">'))).not.toEqual([]);
    expect(codesOf(needs('"simple"'), passing('DataKind<"live">'))).not.toEqual([]);
  });
});
