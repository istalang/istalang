/**
 * `spawn f(x).result()` → `(spawn f(x)).result()`: a spawn's call, then more postfix on its line.
 *
 * The call is `spawn`'s operand up to its first call: a name or a bracket group, then member
 * accesses, type arguments, indexing and struct literals, then the `(…)` that calls. It is wrapped
 * only when a postfix continues it on the same line; a bare `spawn f(x)`, or one wrapped already,
 * is left alone. A chain doesn't cross a line break, as layout ends an expression there.
 *
 * The word is read where an operand starts: a `spawn` already called (`spawn(`), or following what
 * ends an operand or reaches a member (`x.spawn`), is no spawn of a call. That keeps the rule its
 * own fixed point: the `(` it writes before a `spawn` never follows the end of another chain.
 */

import type { Token } from '../../../../src/compiler/syntax/tokens/index.ts';
import { insertion, type Rewrite } from '../../pass.ts';
import { closesBracket, opensBracket, pastToken, type TokenRun, wordAt } from '../../token-runs.ts';

const rule = 'spawn-chain';

const memberAccesses: ReadonlySet<string> = new Set(['.', '?.', '->', '?->']);

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

/** How each token of a type argument list changes its depth. */
const angleDepths: Readonly<Record<string, number>> = { '<': 1, '>': -1, '>>': -2 };

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
      !(operandEnds.has(before.kind) || memberAccesses.has(before.kind)))
  );
}

function continues(token: Token): boolean {
  return !token.firstOnLine && continuations.has(token.kind);
}

/** The index of the `)` ending the call that the operand at `index` makes; undefined if none. */
function callEndAfter(run: TokenRun, index: number): number | undefined {
  let at = afterPrimary(run, index);
  while (at !== undefined) {
    const token = run.tokens[at];
    if (token === undefined || token.firstOnLine) {
      return undefined;
    }
    if (token.kind === '(') {
      return run.partnerOf(at);
    }
    at = afterStep(run, at);
  }
  return undefined;
}

function afterPrimary(run: TokenRun, index: number): number | undefined {
  if (run.tokens[index]?.kind === 'identifier') {
    return index + 1;
  }
  return opensBracket(run, index) ? pastToken(run, index) : undefined;
}

/** The index past the step of a chain at `index`, before its call; undefined if none is there. */
function afterStep(run: TokenRun, index: number): number | undefined {
  const kind = run.tokens[index]?.kind ?? 'end';
  if (memberAccesses.has(kind)) {
    return run.tokens[index + 1]?.kind === 'identifier' ? index + 2 : undefined;
  }
  if (kind === '<') {
    return afterTypeArguments(run, index);
  }
  return kind === '[' || kind === '{' ? pastToken(run, index) : undefined;
}

/** The index past the type argument list opening at `index`; undefined if it doesn't close. */
function afterTypeArguments(run: TokenRun, index: number): number | undefined {
  let depth = 0;
  for (let at: number | undefined = index; at !== undefined; ) {
    const kind = run.tokens[at]?.kind ?? 'end';
    depth += angleDepths[kind] ?? 0;
    if (depth <= 0 || kind === 'end' || kind === ';' || closesBracket(run, at)) {
      return depth === 0 ? at + 1 : undefined;
    }
    at = pastToken(run, at);
  }
  return undefined;
}
