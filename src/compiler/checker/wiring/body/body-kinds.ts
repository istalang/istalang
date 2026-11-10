/**
 * What a body is checked as, and what it must produce, if declared: a function's, async or not, or
 * a value of its own, such as a constant's or a function's parameter defaults, which can't return.
 * Defaults are part of their function (§3.3), so they are checked in its scope, of its kind, but
 * never wait.
 */

import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Type } from '../../types/type/index.ts';

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
      /** The function whose parameter defaults it computes. */
      readonly defaultsOf?: FunctionDeclaration | undefined;
    };

/** The function whose scope a body of `kind` is checked in, and whether it may wait; none for a value. */
export function ownScopeOf(
  kind: BodyKind,
): { readonly declaration: FunctionDeclaration; readonly isAsync: boolean } | undefined {
  if (kind.kind === 'function') {
    return kind;
  }
  return kind.defaultsOf === undefined
    ? undefined
    : { declaration: kind.defaultsOf, isAsync: false };
}
