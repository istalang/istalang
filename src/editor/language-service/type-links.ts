/**
 * The declared types a hover's code names, each with where it is declared, for an editor to link
 * to: an editor can't make the text of code clickable, so a hover lists them beside it. Each is a
 * struct, an enum or an extern type, found anywhere in the types shown (as a type argument, a
 * field's or a function's parameter); a primitive, a type parameter or `Self` is declared nowhere
 * to go to.
 */

import type { Checker } from '../../compiler/checker/check.ts';
import { nominalsIn } from '../../compiler/checker/types/parts/type-parts.ts';
import type { Type } from '../../compiler/checker/types/type/index.ts';
import { type DeclaringName, declaringNameOf } from './reading/declaring-node.ts';

/** A declared type a hover names, by its name, and where it is declared. */
export interface TypeLink extends DeclaringName {
  readonly text: string;
}

/** The declared types `types` name at any depth, each once, in the order they are first met. */
export function typeLinks(checker: Checker, types: readonly Type[]): readonly TypeLink[] {
  const entities = new Set(types.flatMap(nominalsIn).map(({ entity }) => entity));
  return [...entities].flatMap((entity) => {
    const place = declaringNameOf(checker, { kind: 'type', entity });
    return place === undefined ? [] : [{ ...place, text: place.name.text }];
  });
}
