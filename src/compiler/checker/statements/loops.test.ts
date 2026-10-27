import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { inFunction, reported } from '../check.test-kit.ts';
import { checkerDiagnostics as reports } from '../diagnostics/index.ts';

const started = 'async fn job() -> Future<int>: 1\n\n';

describe('labels', () => {
  it.each([
    ['a labelled break', 'outer: for x in [1]:\n  for y in [2]:\n    break outer'],
    ['a labelled continue', 'outer: while c:\n  for y in [2]:\n    continue outer'],
    ['a hold naming a loop', 'outer: for x in [1]:\n  for y in [2]:\n    hold(outer) _ = job()'],
    ['a hold naming a block', 'batch:\n  for y in [2]:\n    hold(batch) _ = job()'],
    ['a hold naming its function', 'for y in [2]:\n  hold(subject) _ = job()'],
    ['one label on two loops side by side', 'a: for x in [1]: break a\na: for y in [2]: break a'],
  ])('accept %s', (_, body) => {
    expect(reported(started + inFunction(body))).toEqual(reportedNothing);
  });

  it.each([
    ['an exit naming no loop', 'for x in [1]: break outer', reports.unknownLoopLabel, 'outer'],
    [
      'an exit naming a block',
      'batch:\n  for x in [1]: continue batch\n  hold(batch) _ = job()',
      reports.blockLabel,
      'batch',
    ],
    [
      'a hold naming no scope',
      'for x in [1]: hold(outer) _ = job()',
      reports.unknownHoldScope,
      'outer',
    ],
    [
      'an exit leaving its local function',
      'outer: for x in [1]:\n  fn inner():\n    for y in [2]: break outer\n  break outer',
      reports.unknownLoopLabel,
      'outer',
    ],
    [
      'a hold naming a loop outside its local function',
      'outer: for x in [1]:\n  async fn later():\n    hold(outer) _ = job()\n  break outer',
      reports.unknownHoldScope,
      'outer',
    ],
    [
      'a label repeating one around it',
      'a: for x in [1]:\n  a: for y in [2]: break a\n  break a',
      reports.repeatedLabel,
      'a',
    ],
    [
      'a label taking the function name',
      'subject: for x in [1]: break subject',
      reports.ownNameLabel,
      'subject',
    ],
    ['a label nothing names', 'outer: for x in [1]: x', reports.unusedLabel, 'outer'],
  ])('report %s', (_, body, diagnostic, spanText) => {
    expect(reported(started + inFunction(body))).toEqual(reportedOnce(diagnostic.code, spanText));
  });
});
