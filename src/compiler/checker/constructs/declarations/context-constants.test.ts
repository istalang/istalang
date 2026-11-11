/**
 * Context constants (spec §3.4): an initializer is ista code that can't await, of the written type
 * if any; a read is an ista call, which the call rule judges where it is read; a constant computed
 * while compiling refuses one once; and one inferred from itself is a cycle.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics as reports } from '../../diagnostics/index.ts';

const counter = ['shared struct Count:', '  value: Int', 'ista const count = new Count{value: 0}'];

/** What checking `lines` after the counter's reports. */
const reportedWith = (...lines: string[]) => reported([...counter, ...lines].join('\n'));

describe('a context constant', () => {
  it('is read by ista code, its type its initializer’s', () => {
    expect(
      reportedWith('ista fn bump() -> Int:', '  count->value = count->value + 1', '  count->value'),
    ).toEqual({ codes: [], spanTexts: [] });
  });

  it.each([
    ['live code, the kinds meeting', 'live fn read() -> Int: count->value', reports.kindsMeet.code],
    [
      'unmarked code, missing its mark',
      'fn read() -> Int: count->value',
      reports.unmarkedCalls.code,
    ],
  ])('is refused read by %s', (_case, line, code) => {
    expect(reportedWith(line)).toEqual({ codes: [code], spanTexts: ['count'] });
  });

  it('is refused read by a lambda of unmarked code, as any ista call there is', () => {
    expect(reportedWith('fn read() -> Int:', '  const f = fn(): count->value', '  f()')).toEqual({
      codes: [reports.unmarkedCalls.code],
      spanTexts: ['count'],
    });
  });

  it('is refused once by a constant computed while compiling', () => {
    expect(reportedWith('const copied = count')).toEqual({
      codes: [reports.notConstant.code],
      spanTexts: ['count'],
    });
  });

  it('is reported at each constant of a cycle inferring its type from itself', () => {
    expect(reported('ista const a = b\nista const b = a')).toEqual({
      codes: [reports.constantCycle.code, reports.constantCycle.code],
      spanTexts: ['a', 'b'],
    });
  });

  it.each([
    [
      'awaits',
      "import * as runtime from 'runtime'\nista const a = await runtime.commit()",
      reports.awaitOutsideAsync.code,
      'await runtime.commit()',
    ],
    [
      'gives what its written type refuses',
      'ista const a: Int = "x"',
      reports.typeMismatch.code,
      '"x"',
    ],
    [
      'calls live code',
      'live fn live() -> Int: 1\nista const a = live()',
      reports.kindsMeet.code,
      'live()',
    ],
  ])('has its initializer refused where it %s', (_case, text, code, spanText) => {
    expect(reported(text)).toEqual({ codes: [code], spanTexts: [spanText] });
  });

  it('is refused a written type of live data where the type is written', () => {
    expect(reported('extern live struct Socket\nista const s: Socket = 1')).toEqual({
      codes: [reports.kindsHeld.code, reports.typeMismatch.code],
      spanTexts: ['Socket', '1'],
    });
  });

  it('names no function its initializer is in: a label may take its name, a hold may not', () => {
    const labelled = 'ista const x: Int = {\n  x: for i in 0..2:\n    break x\n  1\n}';
    expect(reported(labelled)).toEqual({ codes: [], spanTexts: [] });
    const held = 'ista const x: Int = {\n  for i in 0..2:\n    hold(x) _ = 1\n  1\n}';
    expect(reported(held)).toEqual({ codes: [reports.unknownHoldScope.code], spanTexts: ['x'] });
  });
});
