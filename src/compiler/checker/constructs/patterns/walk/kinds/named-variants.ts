/**
 * The variant a pattern names (§3.11), alone, braced or called, tested before its fields are taken
 * apart. The part's enum is the expected type, so a bare variant name is enough.
 */

import type { VariantNaming } from '../../../../../binder/entities.ts';
import type { NamePattern } from '../../../../../syntax/patterns.ts';
import { lastName } from '../../../../../syntax/tree/node.ts';
import type { NamedType } from '../../../../../syntax/types/index.ts';
import type { BodyContext } from '../../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import type { PatternTest } from '../../../../surface/checked-pattern.ts';
import type { FieldMember, NominalDeclaration, Type } from '../../../../types/type/index.ts';
import { errorType } from '../../../../types/type/primitives.ts';
import { typeText } from '../../../../types/type/type-text.ts';
import { chooseVariant } from '../../../../types/written/named-types.ts';
import type { ValuePart } from '../parts.ts';

/**
 * The variant `naming` names, written at `at`, among the variants of the part's enum; undefined
 * after a report, or for a part already in error.
 */
export function namedVariant(
  context: BodyContext,
  at: NamePattern | NamedType,
  naming: VariantNaming,
  part: ValuePart,
): VariantPart | undefined {
  if (part.type.kind === 'error') {
    return undefined;
  }
  const written = lastName(at.path);
  const name = written.text;
  const chosen = chooseVariant(context, { span: at.span, name: written }, naming, part.type);
  if (chosen === undefined) {
    return undefined;
  }
  const found = variantOf(context, { ...part, type: enumOf(part.type, chosen.enum) }, name);
  if (found === undefined) {
    context.report(checkerDiagnostics.typeMismatch(at.span, name, typeText(part.type)));
  }
  return found;
}

/** The test that a part of an enum type holds its variant `name`, with that variant's fields. */
function variantOf(context: BodyContext, part: ValuePart, name: string): VariantPart | undefined {
  const variants = part.type.kind === 'nominal' ? context.checker.variantsOf(part.type) : undefined;
  const index = variants?.findIndex((candidate) => candidate.name === name) ?? -1;
  const found = variants?.[index];
  if (variants === undefined || found === undefined) {
    return undefined;
  }
  return {
    test: { kind: 'variant', path: part.path, variant: index },
    key: name,
    fields: found.fields,
  };
}

/** `type` when it is a type of the enum `declaration`, else the error type. */
function enumOf(type: Type, declaration: NominalDeclaration): Type {
  return type.kind === 'nominal' && type.entity.declaration === declaration ? type : errorType;
}

/** The variant a struct or call pattern names: the test for it, its key among shapes, its fields. */
export interface VariantPart {
  readonly test: PatternTest;
  readonly key: string;
  readonly fields: readonly FieldMember[];
}
