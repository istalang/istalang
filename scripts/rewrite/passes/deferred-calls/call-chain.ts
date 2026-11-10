/**
 * A call as `defer` and `spawn` take one: a name or a bracket group, then member accesses, type
 * arguments, indexing and struct literals, then the `(…)` that calls, all on one line, as layout
 * ends an expression at a line break. Both rules read it here: `spawn-chain` wraps what follows
 * one, and `defer-statement` leaves a `defer` taking one, the deferred form, alone.
 */

import { closesBracket, opensBracket, pastToken, type TokenRun } from '../../token-runs.ts';

export const memberAccesses: ReadonlySet<string> = new Set(['.', '?.', '->', '?->']);

/** How each token of a type argument list changes its depth. */
const angleDepths: Readonly<Record<string, number>> = { '<': 1, '>': -1, '>>': -2 };

/** The index of the `)` ending the call that starts at `index`; undefined if none does. */
export function callEndAfter(run: TokenRun, index: number): number | undefined {
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
