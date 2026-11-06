/**
 * Literal nodes (spec §2): a value written as itself. A literal's value is decoded once, here, as
 * the parser reads it: a number's, a duration's in milliseconds, a string's with its escapes
 * resolved, so no later phase reads its source text again.
 */

import type { NodeOf } from '../../tree/node.ts';

interface IntegerLiteral extends NodeOf<'IntegerLiteral'> {
  readonly value: bigint;
}

interface FloatLiteral extends NodeOf<'FloatLiteral'> {
  readonly value: number;
}

/** `5d`: the value is in milliseconds. */
export interface DurationLiteral extends NodeOf<'DurationLiteral'> {
  readonly value: bigint;
}

/** The decoded text, escapes resolved. */
export interface StringLiteral extends NodeOf<'StringLiteral'> {
  readonly value: string;
}

interface BooleanLiteral extends NodeOf<'BooleanLiteral'> {
  readonly value: boolean;
}

type NoneLiteral = NodeOf<'NoneLiteral'>;

export type Literal =
  | IntegerLiteral
  | FloatLiteral
  | DurationLiteral
  | StringLiteral
  | BooleanLiteral
  | NoneLiteral;
