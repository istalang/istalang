/**
 * The annotation model (§3.16): an annotation as checked, where an annotated item stands, and what
 * later phases may ask of annotations. Checking them is rules/annotations.ts's; the checker's
 * surface (check.ts) and lowering depend on this model without depending on how they are checked.
 */

import type { TypeEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Annotatable, Annotation } from '../../syntax/annotations.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { Statement } from '../../syntax/statements.ts';
import { bodyChildrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { FieldMember, NominalType } from '../types/type.ts';
import type { ConstantForm } from './constant-form.ts';

/** Where an annotated item stands, which decides which annotations mean anything on it (§3.16). */
export type AnnotationPlace =
  /** A field: of a struct, a variant or a trait, whose declared type its annotations' check reads. */
  | { readonly kind: 'field' }
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

/** Whether what `entity` declares may annotate (§3.16): a struct, not a shared or an extern one. */
export function canAnnotate(entity: TypeEntity): boolean {
  return entity.declaration.kind === 'StructDeclaration';
}

/**
 * Where a statement of a body stands: a local function's annotations mean what a function's do,
 * and any other statement's whether it waits, at an `await` or `select` of its own rather than in
 * a function it nests.
 */
export function statementPlace(statement: Statement): AnnotationPlace {
  return statement.kind === 'FunctionDeclaration'
    ? { kind: 'function' }
    : { kind: 'statement', waits: waits(statement) };
}

function waits(node: SyntaxNode): boolean {
  return (
    node.kind === 'Await' ||
    (node.kind === 'Select' && node.awaits) ||
    bodyChildrenOf(node).some(waits)
  );
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
  /** The checking of `annotation`'s value, on its own in `module`, wherever it stands. */
  readonly bodyOf: (module: ModuleId, annotation: Annotation) => CheckedBody;
}
