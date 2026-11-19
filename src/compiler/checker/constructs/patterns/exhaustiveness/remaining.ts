/**
 * The remaining type of a `match` case (§11.3): the subject's type without the members of a union
 * that earlier cases without a guard took whole, which a case's binder (`case v:`, `as`) has. The
 * subject keeps its own type; only what a case binds is narrowed.
 *
 * A member is taken whole when a value of it can reach no later case, which is the usefulness
 * question exhaustiveness answers, so a member split over several cases (`case true:` and then
 * `case false:` of a `Bool` member) counts once they all have run.
 */

import type { Type } from '../../../types/type/index.ts';
import { unionOfNormalized } from '../../../types/unions/unions.ts';
import type { ValuePart } from '../walk/parts.ts';
import { analyze, anyShape, type CaseShape } from './exhaustiveness.ts';
import { memberShape, type ShapeChecker, signatureOf } from './shapes.ts';

/** What remains of `subject` for the case after `cases`, those of them without a guard counting. */
export function remainingType(
  checker: ShapeChecker,
  subject: Type,
  cases: readonly CaseShape[],
): Type {
  const taking = cases.filter(({ guarded }) => !guarded);
  if (subject.kind !== 'union' || taking.length === 0) {
    return subject;
  }
  const left = subject.members.filter((member) => {
    const probe = { shape: memberShape(member, anyShape), guarded: false };
    const { unreachable } = analyze(signatureOf(checker), subject, [...taking, probe]);
    return !unreachable.includes(taking.length);
  });
  return left.length === subject.members.length || left.length === 0
    ? subject
    : unionOfNormalized(left);
}

/** The whole value of `subject` as a case whose binder has `remaining` takes it. */
export function subjectPart(subject: Type, remaining: Type): ValuePart {
  return remaining === subject || subject.kind !== 'union'
    ? { type: subject, path: [] }
    : { type: remaining, path: [], narrowedFrom: subject };
}
