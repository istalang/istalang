/**
 * How a flow's root gives its value (writer.ts): by returning from the entry, or, written inline (a
 * default's, a context constant's initializer), into a register, then going on past the flow. As a
 * return releases everything, an inline flow then lets go of everything it made but what its
 * `hold`s keep for the function, which the entry's return lets go of: once it has given its
 * value, so what that disposes may read a context constant made of it (§7.1).
 */

import type { Register } from '../../../definition/operands.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeWriter } from '../functions/code-writer.ts';

/**
 * Where a flow's root gives its value: returning it; or into a register, made the instance's
 * context constant `name` where it is that constant's initializer, at its declaration's `span`.
 */
export type FlowEnd =
  | { readonly kind: 'return' }
  | { readonly kind: 'into'; readonly into: Register }
  | {
      readonly kind: 'contextConstant';
      readonly into: Register;
      readonly name: string;
      readonly span: AnchoredSpan;
    };

/** What an inline flow made: the registers since `first`, but the function's `kept` lists. */
interface Made {
  readonly first: number;
  readonly kept: readonly Register[];
}

/**
 * Where an inline flow's root has given its value into `end`: the context constant made of it,
 * then everything it made let go of (the banner).
 */
export function givenInline(
  code: CodeWriter,
  end: Exclude<FlowEnd, { readonly kind: 'return' }>,
  { first, kept }: Made,
  span: AnchoredSpan,
): void {
  if (end.kind === 'contextConstant') {
    code.emit({ kind: 'makeContextConstant', span: end.span, name: end.name, value: end.into });
  }
  const ended = code
    .registersSince(first)
    .filter((register) => register !== end.into && !kept.includes(register));
  code.letGo(ended, span);
}
