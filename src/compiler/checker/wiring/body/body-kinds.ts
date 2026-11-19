/**
 * What a body is checked as, and what it must produce, if declared: a function's, async or not, or
 * a value of its own, such as a constant's or a function's parameter defaults, which can't return.
 * A value may be checked within a function, in its scope, of its kind, but never waiting, as
 * defaults are part of their function (§6.1); or within a context constant, as its initializer,
 * ista code outside any function (§7.1).
 */

import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { OwnScope } from '../../constructs/closures/function-scope.ts';
import { type KindLookup, kindOfFunction, simpleMark } from '../../types/type/function-kinds.ts';
import type { Type } from '../../types/type/index.ts';
import { markType } from '../../types/type/primitives.ts';

export type BodyKind =
  | {
      readonly kind: 'function';
      readonly declaration: FunctionDeclaration;
      readonly isAsync: boolean;
      readonly declaredResult: Type | undefined;
    }
  | {
      readonly kind: 'value';
      readonly declaredResult: Type | undefined;
      /** The function whose defaults it computes, or the context constant it initializes. */
      readonly within?: FunctionDeclaration | ContextConstantDeclaration | undefined;
    };

/**
 * The scope a body of `kind` is checked in: its function's, or a value's, outside any function,
 * of the kind of what it is within, simple where it is within nothing.
 */
export function ownScopeOf(lookup: KindLookup, kind: BodyKind): OwnScope {
  if (kind.kind === 'function') {
    const { declaration, isAsync } = kind;
    return { function: declaration, isAsync, codeKind: kindOfFunction(lookup, declaration) };
  }
  const { within } = kind;
  if (within?.kind === 'FunctionDeclaration') {
    return { function: within, isAsync: false, codeKind: kindOfFunction(lookup, within) };
  }
  const codeKind = within === undefined ? simpleMark : markType('ista');
  return { function: undefined, isAsync: false, codeKind };
}
