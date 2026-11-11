/**
 * The kind lowering gives the entries it writes (docs/arch/definition.md, "Frames"): an entry whose
 * body may wait runs in its function's kind (§3.3), concrete in every instance, since a function
 * generic over its mark is compiled once per mark it is used at, the mark an instance's type
 * argument; one whose body never waits is simple, callable from either kind.
 *
 * An async lambda given no kind in code of either kind has no kind of its own to wait in; it waits
 * in memory, as live code, which is what a host starting such code runs it as.
 */

import type { CodeMode } from '../../../definition/tables/functions.ts';
import type { Checker } from '../../checker/check.ts';
import { persistenceOf } from '../../checker/types/type/function-kinds.ts';
import type { FunctionType, Type } from '../../checker/types/type/index.ts';
import { awaitedOf } from '../../checker/types/type/well-known.ts';

/** The mode of an entry whose body may wait when `isAsync`, of a function of kind `kind`. */
export function codeModeOf(isAsync: boolean, kind: Type): CodeMode {
  if (!isAsync) {
    return 'simple';
  }
  return persistenceOf(kind) ?? 'live';
}

/**
 * The kind an entry built as a function of `type` waits in: that of the future it gives, which a
 * simple function type's mark doesn't say; its mark where it gives none.
 */
export function builtKindOf(checker: Checker, type: FunctionType): Type {
  return awaitedOf(checker, type.result)?.mode ?? type.mark;
}
