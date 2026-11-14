/**
 * A constraint being met by a type at a use site (conformance.ts), and what a search found for one
 * of its requirements comes to: the call meeting it, or the failure reported. Each judgment here is
 * pure; finding a witness is the caller's (conformance.ts), handed in where a judgment needs one,
 * so these sit beside conformance without a cycle.
 *
 * A required field is met by a field of its name the type stores, of its type, or else by a getter
 * giving it (§3.10), chosen as a witness is and a witness of the constraint as its functions' are.
 */

import type { UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { RequiredField } from '../../surface/checked-field.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { requiredFields, requiredFieldType } from '../../types/traits/constraints.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import {
  endlessAt,
  type Failure,
  goalKey,
  isFailure,
  type Search,
  type WitnessOutcome,
} from './witness-outcomes.ts';

/**
 * A constraint being met by a type at a use site, `onValues` when only calls on its values need it.
 */
export interface Meeting {
  readonly site: UseSite;
  readonly type: Type;
  readonly constraint: Constraint;
  readonly onValues?: boolean;
}

/** The goal `meeting` is, as a search keeps it (`SearchGoals`). */
export function meetingKey({ site, type, constraint }: Meeting): string {
  return goalKey(site.checker.typeKeys, type, constraint);
}

/** Reports that the type lacks `missing` to meet the constraint. */
export function lacks({ site, type, constraint }: Meeting, missing: string): Failure {
  const trait = constraint.trait.name.text;
  site.report((at) => checkerDiagnostics.notConforming(at, typeText(type), trait, missing));
  return 'failed';
}

/**
 * The getters meeting the fields `meeting`'s trait requires (§3.10), each the one `getterOf` finds
 * where the type stores none of its type; the failure reported for the first it lacks.
 */
export function fieldGetters(
  meeting: Meeting,
  search: Search,
  getterOf: (required: RequiredField) => WitnessOutcome,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  const { checker } = site;
  const getters: ResolvedCall[] = [];
  for (const field of requiredFields(constraint.trait)) {
    const name = field.name.text;
    const fieldType = requiredFieldType(checker, constraint, field, type);
    const lacking = () => lacks(meeting, `a field '${name}: ${typeText(fieldType)}'`);
    const stored = fieldOf(checker, type, name);
    if (stored !== undefined && !sameType(stored.member.type, fieldType)) {
      return lacking();
    }
    if (stored === undefined) {
      const getter = getterOf({ constraint, field });
      const met = metBy(meeting, search, getter, { name, unmet: lacking });
      if (isFailure(met)) {
        return met;
      }
      getters.push(met);
    }
  }
  return getters;
}

/**
 * What `witness`, found for the requirement `name` of `meeting`'s trait, meets it with: its call,
 * or, where no function is declared for it, `unmet`'s; else the failure reported.
 */
export function metBy(
  meeting: Meeting,
  search: Search,
  witness: WitnessOutcome,
  { name, unmet }: { readonly name: string; readonly unmet: () => ResolvedCall | Failure },
): ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  switch (witness.kind) {
    case 'call':
      return witness.call;
    case 'none': {
      const met = unmet();
      return met === 'endless' ? endlessAt(site, search, type, constraint) : met;
    }
    case 'ambiguous':
      return lacks(meeting, `a single '${name}' as ${constraint.trait.name.text} declares it`);
    case 'wrongResult': {
      const [wanted, given] = [typeText(witness.required), typeText(witness.given)];
      return lacks(meeting, `'${name}' giving ${wanted}, where the one declared gives ${given}`);
    }
    case 'endless':
      return endlessAt(site, search, type, constraint);
    case 'failed':
      return 'failed';
    default: {
      const unhandled: never = witness;
      return unhandled;
    }
  }
}
