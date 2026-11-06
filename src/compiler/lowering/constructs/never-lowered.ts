/**
 * The entry for node kinds that never reach lowering as values: `Missing` and `Invalid` stand for
 * syntax the parser reported, and lowering runs only on a program with no errors; a `Reference`
 * (`&x`) is lowered by the call it is a whole argument of (constructs/expressions/calls.ts), and
 * anywhere else the parser reported it. Reaching this entry is a compiler bug, so it says so
 * loudly.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { FunctionContext } from '../context.ts';

export const neverLowered = (_context: FunctionContext, node: NodeOf<string>): never => {
  unreachable(
    `A ${node.kind} never reaches lowering as a value; the checker should have refused it.`,
  );
};
