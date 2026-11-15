/**
 * Running over a struct's fields (§4): a field loop, an array comprehension and a struct
 * comprehension each check what their header heads once per pass over the fields it visits
 * (`fieldPassesOver`). Over a value's fields, its subject is checked once, and the header's key and
 * value take apart the pair of the pass's key and value; over a type's keys, the key the header
 * declares stands for the pass's (contexts/passes.ts `keyBinding`). A subject with no fields to
 * visit is reported, and what the header heads checked once with nothing known of them, so each
 * mistake in it is still found.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { FieldHeader, FieldLoopHeader } from '../../../syntax/expressions/index.ts';
import type { BodyContext, CheckedPasses } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FieldPassType } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { fieldTypeOf, keyName, keysOf } from '../../types/traits/struct-keys.ts';
import { keyParameter, membersOf, type Type } from '../../types/type/index.ts';
import { errorType, isPrimitive, neverType, tupleType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { unionOf } from '../../types/unions/unions.ts';
import { declareTargets } from '../patterns/targets.ts';

/** The passes over the fields `header` visits, which this checks. */
export function checkedFieldPasses(
  context: BodyContext,
  header: FieldLoopHeader,
): readonly FieldPassType[] {
  const passes =
    header.kind === 'TypeParameter' ? typePasses(context, header) : valuePasses(context, header);
  return passes ?? [{ visits: { kind: 'none' }, key: errorType, value: errorType }];
}

/**
 * The passes over the fields of `header`'s subject, reported when it has none. Its passes read its
 * fields at once, so it is read settled, never open in a scope.
 */
function valuePasses(
  context: BodyContext,
  header: FieldHeader,
): readonly FieldPassType[] | undefined {
  const subject = context.settled(header.subject);
  const passes = fieldPassesOver(context.checker, subject, header);
  if (passes === undefined && subject.kind !== 'error') {
    context.report(checkerDiagnostics.fieldLoopSubject(header.subject.span, typeText(subject)));
  }
  return passes;
}

/**
 * The passes over the keys of the type `header`'s `keyof` names, whose resolution reports a type
 * with none.
 */
function typePasses(
  context: BodyContext,
  header: TypeParameter,
): readonly FieldPassType[] | undefined {
  const keys = header.memberOf;
  return keys?.kind !== 'KeyofType' || context.resolveType(keys).kind === 'error'
    ? undefined
    : fieldPassesOver(context.checker, context.resolveType(keys.owner), header);
}

/** The type whose fields `header` visits, as the pass being checked reads it. */
export function visitedType(context: BodyContext, header: FieldLoopHeader): Type {
  if (header.kind === 'FieldHeader') {
    return context.typeOf(header.subject);
  }
  return header.memberOf?.kind === 'KeyofType'
    ? context.resolveType(header.memberOf.owner)
    : errorType;
}

/**
 * Runs `each` once per pass of `passes`, `header`'s key bound to the pass's: over a value's fields,
 * its key and value; over a type's keys, the key it declares, as its name records for tools.
 */
export function inFieldPasses(
  context: BodyContext,
  header: FieldLoopHeader,
  passes: readonly FieldPassType[],
  each: (pass: FieldPassType) => void,
): CheckedPasses {
  return context.fieldPasses(header, passes, (pass) => {
    if (header.kind === 'FieldHeader') {
      declareTargets(context, header, tupleType([pass.key, pass.value]));
    } else {
      context.recordWritten(header.name, pass.key);
    }
    each(pass);
  });
}

/**
 * The passes a field loop's body is checked in over a value of `subject`, or its keys (§4): one
 * per key a literal names, its value that field's type; and, for the keys not known yet, one pass whose key
 * is a member parameter keyed by `header` ranging over them, its value the field that key names;
 * a struct with no field, or a subject with no value (§2), one pass visiting none (`noFieldPass`).
 * Undefined when `subject` has no keys.
 */
function fieldPassesOver(
  checker: CheckerContext,
  subject: Type,
  header: FieldLoopHeader,
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
  const key = keyParameter(header, unionOf(others, checker.typeRules));
  return [...named, { visits: { kind: 'others' }, key, value: fieldTypeOf(checker, subject, key) }];
}

/**
 * The pass over a struct with no field: its body never runs, so it is checked once for the mistakes
 * that don't depend on a field, its key and value of type `Never` (`keyof {}`), whose operations
 * report nothing (resolution/calls/stopped-operations.ts).
 */
const noFieldPass: FieldPassType = { visits: { kind: 'none' }, key: neverType, value: neverType };
