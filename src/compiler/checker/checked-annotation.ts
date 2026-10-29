/**
 * The annotation model (§3.16): an annotation as checked, where an annotated item stands, and what
 * later phases may ask of annotations. Checking them is rules/annotations.ts's; the checker's
 * surface (check.ts) and lowering depend on this model without depending on how they are checked.
 */

import type { ModuleId } from '../program/program.ts';
import type { Annotatable, Annotation } from '../syntax/annotations.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { Statement } from '../syntax/statements.ts';
import type { CheckedBody } from './check.ts';
import type { ConstantForm } from './constant-form.ts';
import type { FieldMember, NominalType, Type } from './types/type.ts';

/** Where an annotated item stands, which decides which annotations mean anything on it (§3.16). */
export type AnnotationPlace =
  | { readonly kind: 'field'; readonly type: Type }
  | { readonly kind: 'function' }
  | { readonly kind: 'statement'; readonly waits: boolean }
  /** Anything else, named as a diagnostic says it: `an enum variant`, `a struct declaration`. */
  | { readonly kind: 'other'; readonly description: string };

/** An annotation as checked: its struct type and its value, computed at compile time. */
export interface CheckedAnnotation {
  readonly node: Annotation;
  readonly type: NominalType;
  readonly form: ConstantForm;
}

/** What later phases ask of annotations: an item's, a field's, and a statement's waypoint. */
export interface AnnotationQueries {
  /** The annotations on `item` of `module`, standing at `place`, checked once. */
  readonly of: (
    module: ModuleId,
    item: Annotatable & NodeOf<string>,
    place: AnnotationPlace,
  ) => readonly CheckedAnnotation[];
  /** The annotations on a struct's or variant's field, checked where it is declared. */
  readonly ofField: (field: FieldMember) => readonly CheckedAnnotation[];
  /** The name a statement's `@Waypoint` gives where it waits (§10); undefined without one. */
  readonly waypointOf: (module: ModuleId, statement: Statement) => string | undefined;
  /** The title a function's `@Suite` gives its suite (§10); undefined without one. */
  readonly suiteTitleOf: (module: ModuleId, declaration: FunctionDeclaration) => string | undefined;
  /** The checking of `annotation`'s value; undefined until its item's annotations are checked. */
  readonly bodyOf: (annotation: Annotation) => CheckedBody | undefined;
}
