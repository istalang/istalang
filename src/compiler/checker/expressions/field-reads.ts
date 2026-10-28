/**
 * Which field `x.f` reads, and how the read reaches it (§3.1, §3.10), found once as it is checked
 * (structs.ts) and recorded for lowering (checked-field.ts): a struct's field, declared or
 * anonymous, at its position, or, through a type parameter or an `any` type, a field a
 * constraint's trait requires. A field called, `x.f(…)`, is found the same way (calls.ts).
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import {
  type FieldRead,
  type FoundField,
  requiredFieldRead,
  structFieldOf,
} from '../checked-field.ts';
import type { CheckerContext, FieldReadRecord } from '../context.ts';
import { knownConstraints, requiredFields, requiredFieldType } from '../traits/constraints.ts';
import type { Type } from '../types/type.ts';

/** The field reads of one body, recorded as each is checked. */
export class FieldReads implements FieldReadRecord {
  readonly #reads = new Map<MemberAccess, FieldRead>();

  record(access: MemberAccess, read: FieldRead): void {
    this.#reads.set(access, read);
  }

  of(access: MemberAccess): FieldRead {
    const read = this.#reads.get(access);
    if (read === undefined) {
      unreachable(`No field read was recorded at ${access.span.start}.`);
    }
    return read;
  }
}

/** The field `name` of `type`: a struct's, or, through a constraint on it, one its trait requires. */
export function fieldOf(checker: CheckerContext, type: Type, name: string): FoundField | undefined {
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return structFieldOf(checker, type, name);
  }
  for (const constraint of knownConstraints(checker, type)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return {
        type: requiredFieldType(checker, constraint, field, type),
        read: requiredFieldRead(checker, type, { trait: constraint.trait, field }),
      };
    }
  }
  return undefined;
}
