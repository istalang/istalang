/**
 * Member bounds on associated types (§3.10): `type Mode in Persistence` makes `T.Mode` one member
 * of the union, as a member parameter is, so it is a member argument and a requirement's mark; a
 * type meets the bound with an associated type of its own that is one member, an extern struct's
 * included.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, reportedMessages } from '../../rules/kinds/kinds.test-kit.ts';

const { notConforming, notMemberArgument } = checkerDiagnostics;

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
});
