/**
 * What a call gives a body, by position (design.md §5.3): its parameters, a closure's captures and
 * the cells of the captured `let`s, its own closure, the globals it names, and the parts of those
 * a body reads (design.md §5.7). Summaries name them; never nodes or spans, so an edit that keeps a function's effects keeps its summary.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import { typeKeys } from '../../types/identity/type-keys.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { Type } from '../../types/type/index.ts';
import type { Part } from '../flow/flow-ir.ts';

/** What a call gives a body, by position. */
export type Input =
  | { readonly kind: 'parameter' | 'capture' | 'cell'; readonly index: number }
  | { readonly kind: 'self' }
  | { readonly kind: 'global'; readonly entity: VariableEntity; readonly type: Type }
  | InputPath;

/**
 * A part of an input as given (design.md §5.7): `of`'s part `part`, named by `key` alike in every
 * function, read through a handle or inside a value (`read`), of type `type`. Requirements and
 * effects name them, so a caller checks and relates the parts of what it gave.
 */
interface InputPath {
  readonly kind: 'path';
  readonly of: Input;
  readonly part: Part;
  readonly key: string;
  readonly read: 'through' | 'part';
  readonly type: Type;
}

/** Whether two inputs are one, alike in the types a global or a part carries and how a part is read. */
export function sameInput(first: Input, second: Input): boolean {
  if (inputKey(first) !== inputKey(second)) {
    return false;
  }
  if (first.kind === 'path' && second.kind === 'path') {
    return (
      first.read === second.read &&
      sameTypeSpelled(first.type, second.type) &&
      sameInput(first.of, second.of)
    );
  }
  return first.kind === 'global' && second.kind === 'global'
    ? sameTypeSpelled(first.type, second.type)
    : true;
}

/** A key naming `input`, for sets of inputs. */
export function inputKey(input: Input): string {
  switch (input.kind) {
    case 'self':
      return 'self';
    case 'global':
      return `global:${typeKeys.identityOf(input.entity)}`;
    case 'path':
      return `${inputKey(input.of)}/${input.key}`;
    default:
      return `${input.kind}:${input.index}`;
  }
}

/** Two inputs a requirement names: what may not come to reach (or share with) what. */
export interface InputPair {
  readonly holder: Input;
  readonly value: Input;
}
