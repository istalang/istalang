/**
 * Running over a struct's fields (§4): a field loop, an array comprehension and a struct
 * comprehension each check their subject once, then what their header heads once per pass over
 * its fields (traits/struct-keys.ts `fieldPassesOver`), the header's key and value taking apart the
 * pair of the pass's key and value. A subject with no fields to visit is reported, and what the
 * header heads checked once with nothing known of them, so each mistake in it is still found.
 */

import type { FieldHeader } from '../../../syntax/expressions/index.ts';
import type { BodyContext, CheckedPasses } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FieldPassType } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { declareTargets } from '../../patterns/targets.ts';
import { fieldTypeOf, keyName, keysOf } from '../../traits/struct-keys.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, isPrimitive, neverType, tupleType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';
import { membersOf, unionOf } from '../../types/unions/unions.ts';

/** The passes over the fields of `header`'s subject, which this checks. */
export function checkedFieldPasses(
  context: BodyContext,
  header: FieldHeader,
): readonly FieldPassType[] {
  const subject = context.expression(header.subject);
  const passes = fieldPassesOver(context.checker, subject, header);
  if (passes === undefined && subject.kind !== 'error') {
    context.report(checkerDiagnostics.fieldLoopSubject(header.subject.span, typeText(subject)));
  }
  return passes ?? [{ visits: { kind: 'none' }, key: errorType, value: errorType }];
}

/** Runs `each` once per pass of `passes`, `header`'s key and value bound to the pass's. */
export function inFieldPasses(
  context: BodyContext,
  header: FieldHeader,
  passes: readonly FieldPassType[],
  each: (pass: FieldPassType) => void,
): CheckedPasses {
  return context.fieldPasses(header, passes, (pass) => {
    declareTargets(context, header, tupleType([pass.key, pass.value]));
    each(pass);
  });
}

/**
 * The passes a field loop's body is checked in over a value of `subject` (§4): one per key a
 * literal names, its value that field's type; and, for the keys not known yet, one pass whose key
 * is a member parameter keyed by `header` ranging over them, its value the field that key names;
 * a struct with no field, or a subject with no value (§2), one pass visiting none (`noFieldPass`).
 * Undefined when `subject` has no keys.
 */
function fieldPassesOver(
  checker: CheckerContext,
  subject: Type,
  header: FieldHeader,
): readonly FieldPassType[] | undefined {
  if (isPrimitive(subject, 'Never')) {
    return [noFieldPass];
  }
  const keys = keysOf(checker, subject, []);
  if (keys.kind === 'error') {
    return undefined;
  }
  const members = membersOf(keys).filter((member) => !isPrimitive(member, 'Never'));
  if (members.length === 0) {
    return [noFieldPass];
  }
  const named = members.flatMap((member): FieldPassType[] => {
    const name = keyName(member);
    return name === undefined
      ? []
      : [
          {
            visits: { kind: 'field', name },
            key: member,
            value: fieldTypeOf(checker, subject, member),
          },
        ];
  });
  const others = members.filter((member) => keyName(member) === undefined);
  if (others.length === 0) {
    return named;
  }
  const within = unionOf(others, checker.typeRules);
  const key: Type = { kind: 'parameter', declaration: header, within };
  return [...named, { visits: { kind: 'others' }, key, value: fieldTypeOf(checker, subject, key) }];
}

/**
 * The pass over a struct with no field: its body never runs, so it is checked once for the mistakes
 * that don't depend on a field, its key and value of type `Never` (`keyof {}`), whose operations
 * report nothing (calls/stopped-operations.ts).
 */
const noFieldPass: FieldPassType = { visits: { kind: 'none' }, key: neverType, value: neverType };
