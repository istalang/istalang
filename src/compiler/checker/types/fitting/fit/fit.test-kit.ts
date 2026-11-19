/**
 * Fitting as unit tests of types/ use it, built without checking a program: no `any` type is met,
 * no struct has a shape and every declaration is invariant, while its futures are the std
 * modules' own, so an async function's type is the one every program has (§6.4).
 */

import { stdProgramOf } from '../../../../binder/bind.test-kit.ts';
import { checkedApart } from '../../../check.test-kit.ts';
import { noProgramRules } from '../../type/type-rules.test-kit.ts';
import { futuresOf } from '../../type/well-known.ts';
import type { Fitting } from './index.ts';

/** Fitting in a program declaring nothing beside the std modules, none of whose types it reads. */
export const fittingApart: Fitting = {
  ...noProgramRules,
  ...futuresOf(checkedApart(stdProgramOf({ 'main.ista': '' }))),
  meetsAny: () => false,
  metInstantiation: () => ({ kind: 'none' }),
  proposedInstantiations: () => [],
  shapeOf: () => undefined,
  memberUnionOf: () => undefined,
  qualifierOf: () => undefined,
  varianceOf: () => [],
};
