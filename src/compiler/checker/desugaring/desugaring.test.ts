/**
 * The desugaring table's contract (index.ts), whatever the sugar: a sugar is checked as its core
 * alone, where it stands, so it joins the constraint scope its core would, keeps no type of its own
 * a failed inference leaves stale, converts once to what is expected of it, and its mistakes read
 * as about the code written.
 */

import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { subjectFlow } from '../rules/flow/build/flow.test-kit.ts';

describe('a sugar checked as its core', () => {
  it('reports only what its core reports where an inference fails, no stale type', () => {
    const text = [
      'struct Box<T, U> { value: T }',
      'fn f():',
      '  const x: Int = Box:',
      '    value: 1',
    ];
    expect(reported(text.join('\n'))).toEqual(
      reportedOnce(checkerDiagnostics.cannotInfer.code, 'Box:\n    value: 1'),
    );
  });

  it('joins the constraint scope it stands in, as its core does', () => {
    const text = [
      'fn tag<T>(parts: Array<String>) -> T: panic("")',
      'fn pair<U>(a: U, b: U) -> U: a',
      'fn f() -> Int: pair(tag`a`, 1)',
    ];
    expect(reported(text.join('\n'))).toEqual(reportedNothing);
  });

  it('converts once to the type expected of it', () => {
    const flow = subjectFlow('const r: any Sendable = 1..5');
    const converting = flow.blocks.flatMap(({ operations }) =>
      operations.flatMap((operation) =>
        operation.op === 'copy' && operation.fit !== undefined ? [operation.site.kind] : [],
      ),
    );
    expect(converting.filter((site) => site !== 'IntegerLiteral')).toEqual(['Range']);
  });

  it("words a template value's toString giving no String as the template's, at the value", () => {
    const text = [
      'struct Bad { x: Int }',
      'fn toString(self: Bad) -> Int: self.x',
      'fn f(b: Bad) -> String: `${b}`',
    ];
    expect(reported(text.join('\n'))).toEqual(
      reportedOnce(checkerDiagnostics.notStringable.code, 'b'),
    );
  });
});
