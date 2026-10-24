/**
 * What a sub-scanner returns: the token's kind and value, plus where it ends.
 *
 * Sub-scanners don't know where a line starts. The main loop owns that, and adds the span and
 * `firstOnLine` to finish the token. The field type is derived from Token, so a new token shape
 * can't fall out of sync with what sub-scanners return.
 */

import type { Token } from '../syntax/tokens.ts';

type DistributiveOmit<Union, Key extends PropertyKey> = Union extends unknown
  ? Omit<Union, Key>
  : never;

export type TokenFields = DistributiveOmit<Token, 'span' | 'firstOnLine'>;

export interface ScannedLexeme {
  readonly end: number;
  readonly token: TokenFields;
}
