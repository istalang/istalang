/**
 * A field of a type by what the type is (§3.5, §3.10): a struct's, or, on a type known only per
 * instantiation, one a trait of its constraints requires or one its struct constraints name
 * (traits/known-constraints.ts). One rule for a field read, a field called and conformance.
 */

import {
  type FoundField,
  namedFieldRead,
  requiredFieldRead,
  structFieldOf,
} from '../checked-field.ts';
import type { CheckerContext } from '../context.ts';
import { unfolded } from '../types/computed-types.ts';
import type { Type } from '../types/type.ts';
import { literalType } from '../types/unions.ts';
import { requiredFields, requiredFieldType } from './constraints.ts';
import { knownConstraints, structConstraintsOn } from './known-constraints.ts';

/**
 * The field `name` of `type`: a struct's, or, on a type known only per instantiation, one a trait
 * of its constraints requires or one its struct constraints name (§3.5, §3.10).
 */
export function fieldOf(
  checker: CheckerContext,
  given: Type,
  name: string,
): FoundField | undefined {
  const type = unfolded(given);
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return structFieldOf(checker, type, name);
  }
  for (const constraint of knownConstraints(checker, type)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return {
        member: {
          name,
          type: requiredFieldType(checker, constraint, field, type),
          declared: {
            node: field,
            module: checker.moduleOf(constraint.trait),
            type: checker.resolveType(checker.moduleOf(constraint.trait), field.type),
          },
        },
        read: requiredFieldRead(checker, type, { trait: constraint.trait, field }),
      };
    }
  }
  const named = structConstraintsOn(checker, type).some((model) =>
    model.named.some((entry) => entry.name === name),
  );
  return named
    ? {
        member: { name, type: checker.typeRules.fieldType(type, literalType(name)) },
        read: namedFieldRead(checker, type, name),
      }
    : undefined;
}
