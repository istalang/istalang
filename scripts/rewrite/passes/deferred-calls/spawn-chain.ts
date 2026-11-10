/**
 * `spawn f(x).result()` → `(spawn f(x)).result()`: a spawn's call, then more postfix on its line.
 *
 * The call is `spawn`'s operand up to its first call (call-chain.ts). It is wrapped only when a
 * postfix continues it on the same line; a bare `spawn f(x)`, or one wrapped already, is left
 * alone.
 *
 * The word is read where an operand starts: a `spawn` already called (`spawn(`), or following what
 * ends an operand or reaches a member (`x.spawn`), is no spawn of a call. `defer` and `spawn` end
 * none, keywords or names, so `defer spawn f().x` reads alike on either side of the change. That
 * keeps the rule its own fixed point: the `(` it writes before a `spawn` never follows the end of
 * another chain.
 */

import type { Token } from '../../../../src/compiler/syntax/tokens/index.ts';
import { insertion, type Rewrite } from '../../pass.ts';
import { type TokenRun, wordAt } from '../../token-runs.ts';
import { callEndAfter, memberAccesses } from './call-chain.ts';

const rule = 'spawn-chain';

/** What may follow a call on its line and continue the expression it ends. */
const continuations: ReadonlySet<string> = new Set([...memberAccesses, '[', '(', '?', '!']);

/** What ends an operand, which an operand can't follow. */
const operandEnds: ReadonlySet<string> = new Set([
  'identifier',
  'integer',
  'float',
  'duration',
  'string',
  'template',
  'docstring',
  'true',
  'false',
  'none',
  ')',
  ']',
  '}',
  '?',
  '!',
  '>',
  '>>',
]);

/**
 * The words that took an operand as keywords and take a call as names: read by their text, so a
 * source reads alike on either side of the change, they end no operand.
 */
const takerWords: ReadonlySet<string> = new Set(['defer', 'spawn']);

export function spawnChains(run: TokenRun): readonly Rewrite[] {
  return run.tokens.flatMap((token, index) => {
    const callEnd = startsOperand(run, index) ? callEndAfter(run, index + 1) : undefined;
    const call = callEnd === undefined ? undefined : run.tokens[callEnd];
    const next = callEnd === undefined ? undefined : run.tokens[callEnd + 1];
    if (call === undefined || next === undefined || !continues(next)) {
      return [];
    }
    return [{ rule, edits: [insertion(token.span.start, '('), insertion(call.span.end, ')')] }];
  });
}

/** Whether the token at `index` is the word `spawn` where an operand starts. */
function startsOperand(run: TokenRun, index: number): boolean {
  const token = run.tokens[index];
  const before = run.tokens[index - 1];
  return (
    token !== undefined &&
    wordAt(run, index) === 'spawn' &&
    run.tokens[index + 1]?.kind !== '(' &&
    (token.firstOnLine ||
      before === undefined ||
      !(endsOperand(run, index - 1) || memberAccesses.has(before.kind)))
  );
}

/** Whether the token at `index` ends an operand, which a taker's word doesn't. */
function endsOperand(run: TokenRun, index: number): boolean {
  const token = run.tokens[index];
  return token !== undefined && operandEnds.has(token.kind) && !takerWords.has(wordAt(run, index));
}

function continues(token: Token): boolean {
  return !token.firstOnLine && continuations.has(token.kind);
}
