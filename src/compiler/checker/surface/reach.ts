/**
 * What a generic function's code reaches (§3.5), as each of its instantiations will: the calls its
 * body and its defaults make, generic as checked, so the types in them may name the function's own
 * type parameters. The expansion rule judges a function by what it reaches
 * (rules/expansion/functions.ts), and lowering closes the same calls per instantiation
 * (witness-closing.ts), so what one counts the other makes.
 */

import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { Checker } from '../check.ts';
import { functionCallsWithin, type ResolvedCall } from './resolved-call.ts';

/** A call a function's code reaches, and the node making it. */
export interface ReachedCall {
  readonly site: NodeOf<string>;
  readonly call: ResolvedCall;
}

type ReachSeams = Pick<Checker, 'bodyOf' | 'defaultsOf'>;

/** Every call `declaration`'s code reaches, at the node making it. */
export function reachedCalls(
  checker: ReachSeams,
  declaration: FunctionDeclaration,
): readonly ReachedCall[] {
  const bodies = [checker.bodyOf(declaration), checker.defaultsOf(declaration)];
  return bodies
    .flatMap((body) => body?.madeCalls() ?? [])
    .flatMap(({ site, call }) => functionCallsWithin(call).map((each) => ({ site, call: each })));
}
