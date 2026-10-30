/**
 * What a place offers: a name and what it names, before presentation (present.ts) decides how it
 * shows and what accepting it writes. Providers only say what may be written; kinds, details,
 * insert text and ranking are derived in one place, from the subject and the place.
 */

import type { Entity } from '../../compiler/binder/entities.ts';
import type { SignatureParameter, VariantMember } from '../../compiler/checker/check.ts';
import type { FieldMember } from '../../compiler/checker/types/type.ts';
import type { FunctionDeclaration } from '../../compiler/syntax/declarations.ts';

export interface Candidate {
  readonly name: string;
  readonly subject: Subject;
  /** A value another case already tests, as a variant a `match` covers: ranked after the rest. */
  readonly covered?: true;
}

/**
 * What a candidate names: a binder entity (a visible name, a module's export), a keyword, a field,
 * a function reached through a value (a method) or a type (a static), a variant reached through
 * its enum, or a parameter a call's argument names.
 */
export type Subject =
  | { readonly kind: 'entity'; readonly entity: Entity }
  | { readonly kind: 'keyword' }
  | { readonly kind: 'field'; readonly field: FieldMember }
  | {
      readonly kind: 'function';
      readonly declaration: FunctionDeclaration;
      readonly through: 'value' | 'type';
    }
  | { readonly kind: 'variant'; readonly variant: VariantMember }
  | { readonly kind: 'argument'; readonly parameter: SignatureParameter };
