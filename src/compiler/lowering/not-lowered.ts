/**
 * The one entry for every construct lowering doesn't handle yet. Lowering runs only on a program
 * the checker accepted, and the checker reports those constructs as not supported (its
 * `unsupported.ts`), so this entry never runs after a clean check; if it does, a phase let one
 * through, and it says so loudly. A feature slice replaces its kinds' entries in the handler
 * tables.
 */

import type { NodeOf } from '../syntax/node.ts';
import type { FunctionContext } from './context.ts';

export const notLowered = (_context: FunctionContext, node: NodeOf<string>): never => {
  throw new Error(
    `Lowering ${node.kind} arrives with its feature; the checker should have said so.`,
  );
};
