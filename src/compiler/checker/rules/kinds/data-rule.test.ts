/**
 * The data rule as a property (proposal 8, Rule 2): over generated programs of marked functions,
 * each handling values of a kind and calling the others, the checker accepts a program exactly when
 * no function handles data, or calls code, of a kind its mark refuses: no ista function holds live
 * data, no live one ista data, no simple one either, and no ista function calls live code, nor the
 * reverse. The model below is the rule's own statement, independent of how the checker finds it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Mark } from '../../../../foundation/language/well-known/index.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

/** What a generated function handles: a value made by a call, or one it takes. */
type Handled =
  | 'liveFuture'
  | 'istaFuture'
  | 'socket'
  | 'slot'
  | 'socketOptional'
  | 'slotOptional'
  | 'socketTupleConversion'
  | 'slotTupleConversion'
  | 'liveDefault'
  | 'istaDefault'
  | 'livePhantomDefault'
  | 'istaPhantomDefault'
  | 'number';

interface Generated {
  readonly mark: Mark;
  readonly handles: readonly Handled[];
  /** The functions declared before it that it calls. */
  readonly calls: readonly number[];
}

const kindOf: Record<Handled, Mark> = {
  liveFuture: 'live',
  istaFuture: 'ista',
  socket: 'live',
  slot: 'ista',
  socketOptional: 'live',
  slotOptional: 'ista',
  socketTupleConversion: 'live',
  slotTupleConversion: 'ista',
  liveDefault: 'live',
  istaDefault: 'ista',
  livePhantomDefault: 'live',
  istaPhantomDefault: 'ista',
  number: 'simple',
};

/** How a function writes a value it handles, in its body. */
const written: Record<Handled, string> = {
  liveFuture: '  _ = liveOne()',
  istaFuture: '  _ = istaOne()',
  socket: '  _ = socketOf()',
  slot: '  _ = Slot.create<Int>()',
  socketOptional: '  const _: Socket? = none',
  slotOptional: '  const _: Slot<Int>? = none',
  socketTupleConversion: '  const _: (Int, Socket?) = unitPair()',
  slotTupleConversion: '  const _: (Int, Slot<Int>?) = unitPair()',
  liveDefault: '  _ = createAndDrop<LiveResource>()',
  istaDefault: '  _ = createAndDrop<IstaResource>()',
  livePhantomDefault: '  _ = createAndDrop<Phantom<LiveResource>>()',
  istaPhantomDefault: '  _ = createAndDrop<Phantom<IstaResource>>()',
  number: '  _ = 1 + 2',
};

const head: Record<Mark, string> = { simple: 'fn', live: 'live fn', ista: 'ista fn' };

/** Whether code of mark `code` may handle data, or call code, of mark `other`. */
function admits(code: Mark, other: Mark): boolean {
  return other === 'simple' || other === code;
}

/** Whether the rule accepts `program`, by its statement alone. */
function accepted(program: readonly Generated[]): boolean {
  return program.every(
    ({ mark, handles, calls }) =>
      handles.every((value) => admits(mark, kindOf[value])) &&
      calls.every((index) => admits(mark, program[index]?.mark ?? 'simple')),
  );
}

function sourceOf(program: readonly Generated[]): string {
  return lines(
    'extern live struct Socket',
    'live fn socketOf() -> Socket: panic("none")',
    'live async fn liveOne() -> Int: 1',
    'ista async fn istaOne() -> Int: 1',
    'shared struct LiveResource { n: Int }',
    'live fn dispose(self: LiveResource): ()',
    'live fn LiveResource.default() -> LiveResource: new LiveResource{n: 1}',
    'shared struct IstaResource { n: Int }',
    'ista fn dispose(self: IstaResource): ()',
    'ista fn IstaResource.default() -> IstaResource: new IstaResource{n: 1}',
    'struct Phantom<T> { tag: Int }',
    'fn Phantom.default<T is Default>() -> Phantom<T>: { const x = T.default(); Phantom<T>{tag: 0} }',
    'fn unitPair() -> (Int, None): (1, none)',
    'fn createAndDrop<T is Default>() -> Int: { const x = T.default(); 0 }',
    ...program.flatMap(({ mark, handles, calls }, index) => [
      `${head[mark]} f${index}():`,
      ...handles.map((value) => written[value]),
      ...calls.map((callee) => `  f${callee}()`),
      '  ()',
    ]),
  );
}

const markArbitrary = fc.constantFrom<Mark>('simple', 'live', 'ista');
const handledArbitrary = fc.constantFrom<Handled>(
  'liveFuture',
  'istaFuture',
  'socket',
  'slot',
  'socketOptional',
  'slotOptional',
  'socketTupleConversion',
  'slotTupleConversion',
  'liveDefault',
  'istaDefault',
  'livePhantomDefault',
  'istaPhantomDefault',
  'number',
);

const programArbitrary = fc
  .array(fc.tuple(markArbitrary, fc.array(handledArbitrary, { maxLength: 3 })), {
    minLength: 1,
    maxLength: 5,
  })
  .chain((functions) =>
    fc.tuple(
      ...functions.map(([mark, handles], index) =>
        fc
          .array(fc.nat({ max: Math.max(index - 1, 0) }), { maxLength: index === 0 ? 0 : 2 })
          .map((calls): Generated => ({ mark, handles, calls })),
      ),
    ),
  );

/** The codes the kinds' rules report. */
const kindCodes = new Set<number>(
  [
    checkerDiagnostics.unmarkedCalls,
    checkerDiagnostics.kindsMeet,
    checkerDiagnostics.unmarkedHolds,
    checkerDiagnostics.kindsHeld,
  ].map(({ code }) => code),
);

describe('the data rule over generated programs', () => {
  it('accepts a program exactly when no function handles or calls what its mark refuses', () => {
    fc.assert(
      fc.property(programArbitrary, (program) => {
        const { codes } = reported(sourceOf(program));
        expect(codes.filter((code) => !kindCodes.has(code))).toEqual([]);
        expect(codes.some((code) => kindCodes.has(code))).toBe(!accepted(program));
      }),
      { numRuns: 60 },
    );
  });

  it('refuses generic instantiations, concrete-instantiation disposals and trait objects that cross worlds', () => {
    expect(
      reported(
        lines(
          'shared struct LiveResource { n: Int }',
          'live fn dispose(self: LiveResource): ()',
          'live fn LiveResource.default() -> LiveResource: new LiveResource{n: 42}',
          'fn createAndDrop<T is Default>() -> Int: { const x = T.default(); 0 }',
          'ista async fn main() -> Int: createAndDrop<LiveResource>()',
        ),
      ).codes,
    ).not.toEqual([]);
    expect(
      reported(
        lines(
          'shared struct Guard<T> { value: T }',
          'live fn dispose(self: Guard<Int>): ()',
          'ista async fn main() -> Int: { const g = new Guard<Int>{value: 1}; g->value }',
        ),
      ).codes,
    ).not.toEqual([]);
    // An `any` value hiding live data is made only in live code, and no call or sendable crossing
    // takes it to ista code, so an ista closure live code makes with it never runs.
    const resource = [
      'shared struct LiveResource { n: Int }',
      'live fn dispose(self: LiveResource): ()',
    ];
    expect(
      reported(
        lines(
          ...resource,
          'live fn makeIstaDropper(r: LiveResource) -> ista fn() -> Unit:',
          '  const d: any Disposable = r',
          '  ista fn(): { const copy = d; () }',
        ),
      ).codes,
    ).toEqual([]);
    expect(
      reported(lines(...resource, 'ista fn hide() -> any Disposable: new LiveResource{n: 1}'))
        .codes,
    ).not.toEqual([]);
  });
});
