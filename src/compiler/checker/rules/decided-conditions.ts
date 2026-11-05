/**
 * Conditions decided by types (§4): an `if`'s condition, or a `match` case's literal pattern, whose
 * outcome the types of its operands already fix, so the branch it rules out never runs and is
 * neither checked nor lowered. This is what lets a field loop's pass (§4), the body written out for
 * one field, skip the code another field's key selects, and the generic loop, its instantiations
 * and the body written out by hand agree.
 *
 * - A value's literals are known when it is written as one, or its type is a literal, a union of
 *   literals, or a member parameter (§3.5) ranging over some: each instantiation makes it one of
 *   them. The keys of a struct not known yet may be any name but those its constraint names (§3.1).
 * - `==` and `!=` are decided when both sides are one literal, or one side is a literal the other
 *   can't hold, and so is `x is` a literal pattern; `not`, `and` and `or` combine decided operands
 *   as they run: `false and x` is false whatever `x` is. A bare `true` or `false` decides nothing:
 *   `if true:` is a block written as a branch, and nothing it holds is ruled out.
 * - Nothing narrows: an undecided condition leaves its operands' types as they are.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { BodyContext } from '../body-context.ts';
import { isMemberParameter, isPrimitive, type LiteralValue, type Type } from '../types/type.ts';
import { membersOf, writtenLiteral } from '../types/unions.ts';

/** The literals a value of some type may be, when known: some values, and maybe any other name. */
interface KnownLiterals {
  readonly values: readonly LiteralValue[];
  /** Any String but these, for the keys of a struct not known yet; undefined when closed. */
  readonly anyNameBut: readonly string[] | undefined;
}

/** The value `condition` always has, by its operands' types; undefined when they don't fix it. */
export function decidedValue(context: BodyContext, condition: Expression): boolean | undefined {
  switch (condition.kind) {
    case 'Parenthesized':
      return decidedValue(context, condition.expression);
    case 'Unary': {
      const operand =
        condition.operator === 'not' ? decidedValue(context, condition.operand) : undefined;
      return operand === undefined ? undefined : !operand;
    }
    case 'Binary':
      return decidedBinary(context, condition);
    case 'Is': {
      const subject = context.typeOf(condition.subject);
      if (subject !== undefined && patternRuledOut(context, condition.pattern, subject)) {
        return false;
      }
      return condition.pattern.kind === 'LiteralPattern'
        ? decidedEqual(
            operandLiterals(context, condition.subject),
            operandLiterals(context, condition.pattern.value),
          )
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Whether the literal pattern `pattern` can't match a value of `subject` (§3.11). */
export function patternRuledOut(context: BodyContext, pattern: Pattern, subject: Type): boolean {
  switch (pattern.kind) {
    case 'LiteralPattern': {
      const value = singleLiteral(operandLiterals(context, pattern.value));
      const known = literalsOf(context, subject);
      return value !== undefined && known !== undefined && !mayBe(known, value);
    }
    case 'OrPattern':
      return pattern.alternatives.every((each) => patternRuledOut(context, each, subject));
    default:
      return false;
  }
}

function decidedBinary(
  context: BodyContext,
  node: Extract<Expression, { kind: 'Binary' }>,
): boolean | undefined {
  const { operator } = node;
  if (operator === 'and' || operator === 'or') {
    const left = decidedValue(context, node.left);
    const right = decidedValue(context, node.right);
    const deciding = operator === 'or';
    if (left === deciding || right === deciding) {
      return deciding;
    }
    return left === undefined || right === undefined ? undefined : !deciding;
  }
  if (operator !== '==' && operator !== '!=') {
    return undefined;
  }
  const equal = decidedEqual(
    operandLiterals(context, node.left),
    operandLiterals(context, node.right),
  );
  return equal === undefined ? undefined : equal === (operator === '==');
}

/** Whether values of two known literal sets are always, or never, equal; else undefined. */
function decidedEqual(
  left: KnownLiterals | undefined,
  right: KnownLiterals | undefined,
): boolean | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const [one, other] = [singleLiteral(left), singleLiteral(right)];
  if (one !== undefined && other !== undefined) {
    return one === other;
  }
  if (one !== undefined && !mayBe(right, one)) {
    return false;
  }
  return other !== undefined && !mayBe(left, other) ? false : undefined;
}

/** The literals `operand` may be: its own, written as a literal, else its type's. */
function operandLiterals(context: BodyContext, operand: Expression): KnownLiterals | undefined {
  const written = writtenLiteral(operand);
  return written === undefined
    ? literalsOf(context, context.typeOf(operand))
    : { values: [written.value], anyNameBut: undefined };
}

/**
 * The literals a value of `type` may be (the module's banner); undefined when not known, and for
 * `Never`, whose value can't exist, so the code comparing it never runs and decides nothing.
 */
function literalsOf(context: BodyContext, type: Type | undefined): KnownLiterals | undefined {
  if (type === undefined || isPrimitive(type, 'Never')) {
    return undefined;
  }
  const ranging = isMemberParameter(type) ? context.checker.fitting.memberUnionOf(type) : type;
  const values: LiteralValue[] = [];
  let anyNameBut: string[] | undefined;
  for (const member of membersOf(ranging ?? type)) {
    if (member.kind === 'literal') {
      values.push(member.value);
    } else if (member.kind === 'keys') {
      anyNameBut = [...(anyNameBut ?? member.without)].filter((name) =>
        member.without.includes(name),
      );
    } else {
      return undefined;
    }
  }
  return { values, anyNameBut };
}

/** The one literal `known` holds; undefined for any other set. */
function singleLiteral(known: KnownLiterals | undefined): LiteralValue | undefined {
  return known?.anyNameBut === undefined && known?.values.length === 1
    ? known.values[0]
    : undefined;
}

/** Whether a value of `known` may be `value`. */
function mayBe(known: KnownLiterals, value: LiteralValue): boolean {
  return (
    known.values.includes(value) ||
    (typeof value === 'string' &&
      known.anyNameBut !== undefined &&
      !known.anyNameBut.includes(value))
  );
}
