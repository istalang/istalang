/**
 * Member bounds on associated types (§3.10): `type Mode in Persistence` makes `T.Mode` one member
 * of the union, as a member parameter is, so it is a member argument and a requirement's mark; a
 * type meets the bound with an associated type of its own that is one member, an extern struct's
 * included.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, reportedMessages, socket } from '../../rules/kinds/kinds.test-kit.ts';

const { memberOfMemberParameter, notConforming, notMemberArgument, unknownMark } =
  checkerDiagnostics;

/** A trait whose requirement is of its `Mode`, a box of either kind, and code needing the trait. */
const waits = [
  'extern shared struct Box<T, K in Persistence>',
  'trait Waits<T>:',
  '  type Mode in Persistence',
  '  Self.Mode fn wait(self: Self, into: Box<T, Self.Mode>)',
  'fn need<W is Waits<Int>>(waiter: W): ()',
];

describe('an associated type bounded to members', () => {
  it('is a member argument and a requirement mark of a type not known yet', () => {
    expect(codesOf(...waits, 'fn hold<W is Waits<Int>>(box: Box<Int, W.Mode>): ()')).toEqual([]);
  });

  it('is no member argument unbounded', () => {
    expect(
      codesOf(
        ...waits,
        'trait Loose:\n  type Mode',
        'fn hold<W is Loose>(box: Box<Int, W.Mode>): ()',
      ),
    ).toEqual([notMemberArgument.code]);
  });

  it('is met by a type whose own is one member', () => {
    const now = [
      'struct Now { type Mode = "ista" }',
      'ista fn wait(self: Now, into: Box<Int, "ista">): ()',
    ];
    expect(codesOf(...waits, ...now, 'ista fn main(): need(Now)')).toEqual([]);
  });

  it('is refused for a type whose own is no member', () => {
    const plain = [
      'struct Plain { type Mode = "simple" }',
      'fn wait(self: Plain, into: Box<Int, "ista">): ()',
    ];
    const { codes, messages } = reportedMessages(...waits, ...plain, 'fn main(): need(Plain)');
    expect(codes).toEqual([notConforming.code]);
    expect(messages[0]).toContain("its associated type 'Mode' (Plain.Mode) to be one member");
  });

  it("is met by an extern struct's own, of either kind", () => {
    const ticket = [
      'extern shared struct Ticket<K in Persistence>:',
      '  type Mode = K',
      'K fn wait<K in Persistence>(self: Ticket<K>, into: Box<Int, K>): ()',
    ];
    expect(
      codesOf(...waits, ...ticket, 'live fn use(ticket: Ticket<"live">): need(ticket)'),
    ).toEqual([]);
    expect(
      codesOf(...waits, ...ticket, 'ista fn use(ticket: Ticket<"ista">): need(ticket)'),
    ).toEqual([]);
  });

  it('is the kind of what holds it, which unmarked code may not', () => {
    expect(codesOf(...waits, 'fn hold<W is Waits<Int>>(box: Box<Int, W.Mode>): ()')).toEqual([]);
    expect(
      codesOf(...waits, 'fn leak<W is Waits<Int>>(waiter: W) -> Future<Int, W.Mode>: leak(waiter)'),
    ).not.toEqual([]);
  });

  it("passes through generic code, the requirement's mark instantiated", () => {
    expect(codesOf(...waits, 'fn pass<W is Waits<Int>>(waiter: W): need(waiter)')).toEqual([]);
    const producer = [
      'trait Producer<K in Persistence>:',
      '  K fn produce(self: Self) -> Future<Int, K>',
      'ista fn run<P is Producer<"ista">>(p: P): _ = p.produce()',
    ];
    expect(codesOf(...producer)).toEqual([]);
  });

  it('is no union standing for one type already, nor a mark unbounded', () => {
    expect(codesOf('trait Bad:\n  type Mode in Self.Mode')).toEqual([memberOfMemberParameter.code]);
    expect(codesOf('trait Bad<K in Persistence>:\n  type Mode in K')).toEqual([
      memberOfMemberParameter.code,
    ]);
    expect(codesOf('trait Bad:\n  type Data\n  Self.Data fn bad(self: Self)')).toEqual([
      unknownMark.code,
    ]);
  });

  it('is of its members kinds, needing no simple bound', () => {
    expect(
      codesOf(
        socket,
        'trait HasItem:\n  type Item in Socket | Int',
        'struct Plug { type Item = Socket }',
        'fn needItem<T is HasItem>(): ()',
        'live fn main(): needItem<Plug>()',
      ),
    ).toEqual([]);
  });

  it('holds its kind in a future of it, refused where the code may not hold it', () => {
    const modes = ['trait Modes:', '  type Mode in Persistence'];
    expect(codesOf(...modes, 'fn hold<W is Modes>(f: Future<Int, W.Mode>): ()')).toEqual([
      checkerDiagnostics.unmarkedHolds.code,
    ]);
    expect(codesOf(...modes, 'live fn hold<W is Modes>(f: Future<Int, W.Mode>): ()')).toEqual([
      checkerDiagnostics.kindsHeld.code,
    ]);
    expect(
      codesOf(
        ...modes,
        'struct Mixed<W is Modes> { a: Future<Int, W.Mode>, b: Future<Int, "live"> }',
      ),
    ).toEqual([checkerDiagnostics.holdsBothKinds.code]);
  });

  it('is a value of one member, as a member parameter is', () => {
    expect(
      codesOf(
        'trait Modes:',
        '  type Mode in Persistence',
        'fn asPersistence<W is Modes>(m: W.Mode) -> Persistence: m',
        'fn asString<W is Modes>(m: W.Mode) -> String: m',
        'fn matchMode<W is Modes>(m: W.Mode) -> Int:',
        '  match m:',
        '    case "live": 1',
        '    case "ista": 2',
      ),
    ).toEqual([]);
  });

  it('bounds no member parameter', () => {
    expect(
      codesOf(
        'trait Modes:\n  type Mode in Persistence',
        'fn f<W is Modes, K in W.Mode>(x: K): ()',
      ),
    ).toEqual([memberOfMemberParameter.code]);
  });

  it('marks a requirement no `any` type can call', () => {
    expect(
      codesOf(
        'trait Waits:',
        '  type Mode in Persistence',
        '  Self.Mode fn wait(self: Self)',
        'fn take(x: any Waits): ()',
      ),
    ).toEqual([checkerDiagnostics.notObjectSafe.code]);
  });
});
