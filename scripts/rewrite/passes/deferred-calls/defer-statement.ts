/**
 * `defer x` → `_ = defer(x)`: a statement starting with the word `defer` defers what follows it.
 *
 * Its operand is the rest of the statement: up to a line starting no deeper than the `defer`, a `;`,
 * or a bracket closing around it, a bracket group whole whatever its lines, so a block lambda
 * (`defer fn(): {` … `}`) or an indented body goes with it. A `defer` already called, followed by
 * `(`, is left alone, which makes the rule its own fixed point, and so is one taking a call
 * (call-chain.ts), the deferred form `defer f(x)` the change brings, which reads its operand
 * differently. So is a `defer` with nothing to defer: nothing, or only characters that start no
 * token (an editor test's cursor mark), or an operand whose brackets don't pair, which wrapping
 * would pair differently.
 */

import type { Token } from '../../../../src/compiler/syntax/tokens/index.ts';
import { insertion, type Rewrite } from '../../pass.ts';
import { closesBracket, columnAt, pastToken, type TokenRun, wordAt } from '../../token-runs.ts';
import { callEndAfter } from './call-chain.ts';

const rule = 'defer-statement';

export function deferStatements(run: TokenRun): readonly Rewrite[] {
  return run.tokens.flatMap((token, index) => {
    const operand =
      token.firstOnLine && wordAt(run, index) === 'defer' ? operandAfter(run, index) : undefined;
    if (operand === undefined) {
      return [];
    }
    const opening = operand.first.firstOnLine
      ? insertion(token.span.end, '(')
      : { span: { start: token.span.end, end: operand.first.span.start }, text: '(' };
    return [
      {
        rule,
        edits: [
          insertion(token.span.start, '_ = '),
          opening,
          insertion(operand.last.span.end, ')'),
        ],
      },
    ];
  });
}

interface Operand {
  readonly first: Token;
  readonly last: Token;
}

/** The operand of the `defer` at `index`, if it has one to wrap. */
function operandAfter(run: TokenRun, index: number): Operand | undefined {
  if (run.tokens[index + 1]?.kind === '(' || callEndAfter(run, index + 1) !== undefined) {
    return undefined;
  }
  const column = columnAt(run, index);
  let end: number | undefined = index + 1;
  while (end !== undefined && !endsStatement(run, end, column)) {
    end = pastToken(run, end);
  }
  const operand = end === undefined ? [] : run.tokens.slice(index + 1, end);
  const [first] = operand;
  const last = operand.at(-1);
  return first === undefined || last === undefined || operand.every(isUnknown)
    ? undefined
    : { first, last };
}

function endsStatement(run: TokenRun, index: number, column: number): boolean {
  const token = run.tokens[index];
  return (
    token === undefined ||
    token.kind === 'end' ||
    token.kind === ';' ||
    closesBracket(run, index) ||
    (token.firstOnLine && columnAt(run, index) <= column)
  );
}

function isUnknown(token: Token): boolean {
  return token.kind === 'unknown';
}
