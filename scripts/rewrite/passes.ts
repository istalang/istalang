/**
 * Every pass the rewriter runs, by the name the command line gives it. A new pass is one entry.
 */

import type { Pass } from './pass.ts';
import { deferredCalls } from './passes/deferred-calls/index.ts';

export const passes = {
  'deferred-calls': deferredCalls,
} satisfies Record<string, Pass>;

export type PassName = keyof typeof passes;

export function isPassName(name: string): name is PassName {
  return Object.hasOwn(passes, name);
}
