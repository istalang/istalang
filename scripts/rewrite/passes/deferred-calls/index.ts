/**
 * The pass making `defer` and `spawn` calls of plain functions: each `defer` statement becomes a
 * call whose result is dropped, and each spawn whose call goes on into more postfix is wrapped, so
 * it keeps its meaning once `spawn` is a function and binds as calls do.
 *
 * It reads tokens on purpose, matching the two words by their text: the same phase turns them from
 * keywords into names, and the pass must read sources from either side of that change alike.
 */

import type { Pass } from '../../pass.ts';
import { tokenRunsOf } from '../../token-runs.ts';
import { deferStatements } from './defer-statement.ts';
import { spawnChains } from './spawn-chain.ts';

export const deferredCalls: Pass = (source) =>
  tokenRunsOf(source).flatMap((run) => [...deferStatements(run), ...spawnChains(run)]);
