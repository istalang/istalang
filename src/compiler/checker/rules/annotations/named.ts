/**
 * One annotation the toolchain reads, found among an item's (§5.5): what the std's declarations
 * say that no code shows, read by the rules that need it (lifetimes' `@Holds` and `@Keeps`,
 * parametricity's `@_Parametric`). An item written with none, as most are, reads no checked
 * annotation, since rules ask at every step of walks over types and calls.
 */

import type { WellKnownDeclaration } from '../../../../foundation/language/well-known/index.ts';
import type {
  ExternStructDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { type CheckedAnnotation, functionPlace } from '../../surface/checked-annotation.ts';

type Reader = Pick<CheckerContext, 'annotations' | 'moduleOf' | 'wellKnownEntity'>;

/** The annotation `known` among `declaration`'s, if it has it. */
export function annotationNamed(
  checker: Reader,
  declaration: ExternStructDeclaration | FunctionDeclaration,
  known: WellKnownDeclaration,
): CheckedAnnotation | undefined {
  if (declaration.annotations === undefined) {
    return undefined;
  }
  const entity = checker.wellKnownEntity(known);
  const module = checker.moduleOf(declaration);
  const place =
    declaration.kind === 'FunctionDeclaration'
      ? functionPlace(declaration)
      : { kind: 'struct' as const, isExtern: true };
  const annotations = checker.annotations.of(module, declaration, place);
  return annotations.find((annotation) => annotation.type.entity === entity);
}
