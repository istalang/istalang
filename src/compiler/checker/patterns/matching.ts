/**
 * Patterns that may fail to match (§3.11): a `match` case's and an `is`'s. The walk is shared with
 * targets (walk.ts); this module checks what only these patterns have, and keeps what lowering
 * reads of them.
 *
 * - A literal is compared with `==`, so it has the part's own type. On a union's value it first
 *   selects its member (members.ts), so `case 1` against an `Int?` compares the `Int` held, and
 *   `case none` selects `None`. One the part's type can't hold is ruled out (§3.11), a `never`
 *   test (checked-pattern.ts), and so is a field's `==` its type fixes to fail.
 * - A field compared with `==` or `!=` follows `==`'s rule (types/unions/equality.ts); any other
 *   comparison calls `compare`. Compared with `==` with a value fitting the field's type, it
 *   counts as a pattern for exhaustiveness (`opt == none` takes an optional's `None`).
 * - A name that refers is a variant without fields, tested like one; a type, a struct without
 *   fields among them, which matches every value of the part's own type with no test, as `_`
 *   does (types/written/pattern-types.ts); or a top-level constant (named qualified, since a bare camelCase name
 *   binds), compared with `==` and acting as a guard for exhaustiveness.
 * - A struct pattern naming a variant tests that variant, then takes its fields apart. The part's
 *   enum is the expected type, so a bare variant name is enough (§3.11).
 * - An array pattern tests its part's length, then reads its items and rest, all through prelude
 *   calls made here, at the pattern: `length`, `compare` against the fixed count when there is a
 *   rest, and `_patternItem` and `_patternRest` (the prelude's, so no program's replaces them).
 * - A range pattern's leaf is ranges.ts's.
 */

import { arrayPatternFunctions } from '../../../language/well-known.ts';
import type { Entity, VariantNaming } from '../../binder/entities.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { lastName } from '../../syntax/node.ts';
import { binaryOperators, isImplicitOperator } from '../../syntax/operators.ts';
import type {
  ArrayPattern,
  CompareFieldPattern,
  LiteralPattern,
  NamePattern,
  Pattern,
  StructPattern,
} from '../../syntax/patterns.ts';
import type { BodyContext, PatternRecord } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Pass, Passes, PassTable } from '../passes.ts';
import { implicitOperatorCall, preludeCall } from '../resolution/implicit.ts';
import { chooseVariant, nameNodeOf } from '../resolution/named.ts';
import { type CheckedPattern, namesBound, type PatternTest } from '../surface/checked-pattern.ts';
import type { ImplicitRole } from '../surface/resolved-call.ts';
import { unfolded } from '../types/computed-types.ts';
import { errorType, intType, isPrimitive, noneType } from '../types/primitives.ts';
import type { NominalDeclaration, Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { comparable, decidedEquality, fitEqualSides, isKnown } from '../types/unions/equality.ts';
import { optionalInner } from '../types/unions/unions.ts';
import { arrayElement } from '../types/well-known.ts';
import { namesOwnType, patternTypeOf } from '../types/written/pattern-types.ts';
import { downcastOf } from './downcasts.ts';
import { anyShape } from './exhaustiveness.ts';
import { bodyScope, otherTypeNamed, type ValuePart } from './parts.ts';
import {
  type ArrayPart,
  failed,
  type Leaf,
  type PatternTests,
  ruledOutLeaf,
  type VariantPart,
} from './pattern-tests.ts';
import { compareFunction, rangeLeaf } from './ranges.ts';
import { subjectPart } from './remaining.ts';
import { literalShape, memberShape, nullaryShape } from './shapes.ts';
import { type WalkedPattern, walkPattern } from './walk.ts';

/** The patterns of one body as checked, for lowering. */
export class CheckedPatterns implements PatternRecord {
  readonly #patterns: PassTable<Pattern, CheckedPattern>;

  constructor(passes: Passes) {
    this.#patterns = passes.table();
  }

  record(pattern: Pattern, checked: CheckedPattern): void {
    this.#patterns.set(pattern, checked);
  }

  patternOf(pattern: Pattern, pass?: Pass): CheckedPattern | undefined {
    return this.#patterns.get(pattern, pass);
  }
}

/**
 * Checks `pattern` against a value of `subject`, declaring the names it binds, which a `match`
 * case binds of what earlier cases left of it (`remaining`, remaining.ts); its shape is undefined
 * when it acts as a guard for exhaustiveness.
 */
export function checkPattern(
  context: BodyContext,
  pattern: Pattern,
  subject: Type,
  remaining: Type = subject,
): WalkedPattern {
  const whole = subjectPart(unfolded(subject), unfolded(remaining));
  const walked = walkPattern(bodyScope(context), testsIn(context), pattern, whole);
  for (const { name, type } of namesBound(walked)) {
    context.variables.declare(name, type);
  }
  context.patterns.record(pattern, walked);
  return walked;
}

function testsIn(context: BodyContext): PatternTests {
  return {
    literal: (node, part) => literal(context, node, part),
    comparison: (item, part) => comparison(context, item, part),
    reference: (node, part) => reference(context, node, part),
    variant: (node, naming, part) =>
      node.type === undefined ? undefined : namedVariant(context, node.type, naming, part),
    downcast: (node, part) => downcastOf(context, node, part),
    array: (node, part) => arrayTest(context, node, part),
    range: (node, part) => rangeLeaf(context, node, part),
  };
}

function arrayTest(
  context: BodyContext,
  node: ArrayPattern,
  part: ValuePart,
): ArrayPart | undefined {
  if (part.type.kind === 'error') {
    return undefined;
  }
  const items = arrayElement(context.checker, part.type);
  if (items === undefined) {
    context.report(checkerDiagnostics.notArrayPattern(node.span, typeText(part.type)));
    return undefined;
  }
  const hasRest = node.elements.some((element) => element.kind === 'RestPattern');
  const count = node.elements.length - (hasRest ? 1 : 0);
  const call = (role: ImplicitRole, name: string, types: readonly Type[], expected?: Type) =>
    preludeCall(context, {
      node,
      role,
      name,
      arguments: types,
      ...(expected === undefined ? {} : { expected }),
    });
  call('length', arrayPatternFunctions.length, [part.type]);
  if (count > 0) {
    call('item', arrayPatternFunctions.item, [part.type, intType], items);
  }
  if (hasRest) {
    call('compare', compareFunction, [intType, intType]);
    call('rest', arrayPatternFunctions.rest, [part.type, intType, intType], part.type);
  }
  const lengthPath = [...part.path, { kind: 'length', site: node } as const];
  const value = { kind: 'int', value: BigInt(count) } as const;
  const test: PatternTest = hasRest
    ? { kind: 'compare', path: lengthPath, site: node, value, relation: 'greaterOrEqual' }
    : { kind: 'equal', path: lengthPath, value, negated: false };
  return { test, items };
}

/**
 * A literal compared with its part by `==`; ruled out where the part's type can't hold it
 * (types/unions/equality.ts): `none` where no value of a known type is `none`.
 */
function literal(context: BodyContext, node: LiteralPattern, part: ValuePart): Leaf {
  const { value } = node;
  if (value.kind === 'NoneLiteral') {
    if (isKnown(part.type) && context.checker.fitOf(noneType, part.type) === undefined) {
      return ruledOutLeaf;
    }
    context.expect(value, part.type);
    return isPrimitive(part.type, 'None') ? { tests: [], shape: anyShape } : failed;
  }
  const compared = { type: context.expression(value, part.type), node: value };
  const whole = { type: part.type, node: undefined };
  const compare = fitEqualSides(context, whole, compared);
  const { memberUnionOf } = context.checker.fitting;
  if (decidedEquality(whole, compared, compare, memberUnionOf) === false) {
    return ruledOutLeaf;
  }
  if (!compare) {
    context.report(
      checkerDiagnostics.typeMismatch(node.span, typeText(part.type), typeText(compared.type)),
    );
  }
  return { tests: [equalTest(part, value, false)], shape: valueShape(context, value, part) };
}

/**
 * A field compared by an operator: an ordering through `compare`, `==` and `!=` built in, ruled
 * out where the part's type fixes it to fail, and testing nothing where it fixes it to pass.
 */
function comparison(context: BodyContext, item: CompareFieldPattern, part: ValuePart): Leaf {
  const { operator, value } = item;
  if (isImplicitOperator(operator)) {
    implicitOperatorCall(context, {
      node: item,
      operator,
      arguments: [
        { type: part.type, node: undefined },
        { type: context.expression(value), node: value },
      ],
    });
    return {
      tests: [
        {
          kind: 'compare',
          path: part.path,
          site: item,
          value: { kind: 'expression', node: value },
          relation: binaryOperators[operator].meaning.relation,
        },
      ],
      shape: undefined,
    };
  }
  const { negated } = binaryOperators[operator].meaning;
  const type = context.expression(value, part.type);
  const whole = { type: part.type, node: undefined };
  const compare = fitEqualSides(context, whole, { type, node: value });
  const { memberUnionOf } = context.checker.fitting;
  const equal = decidedEquality(whole, { type, node: value }, compare, memberUnionOf);
  if (equal !== undefined) {
    return equal === negated ? ruledOutLeaf : { tests: [], shape: undefined };
  }
  if (!compare) {
    context.report(
      checkerDiagnostics.operatorTypes(item.span, operator, [typeText(part.type), typeText(type)]),
    );
  }
  const counts = !negated && context.checker.fitOf(type, part.type) !== undefined;
  return {
    tests: [equalTest(part, value, negated)],
    shape: counts ? valueShape(context, value, part) : undefined,
  };
}

/**
 * The shape of a value a part is compared with, by `==` or as a literal pattern: a variant
 * without fields is that variant, a literal is itself, and `none` an optional's `None` member
 * (§3.11). Any other value acts as a guard.
 */
function valueShape(context: BodyContext, value: Expression, part: ValuePart) {
  if (value.kind === 'NoneLiteral') {
    return optionalInner(part.type) === undefined ? undefined : memberShape(noneType, anyShape);
  }
  const named = nameNodeOf(value);
  const entity = named === undefined ? undefined : context.entityOf(named);
  const isVariant = entity?.kind === 'variant' || entity?.kind === 'variants';
  return named !== undefined && isVariant ? nullaryShape(named.text) : literalShape(value);
}

function reference(context: BodyContext, node: NamePattern, part: ValuePart): Leaf {
  const name = lastName(node.path);
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    const chosen = namedVariant(context, node, entity, part);
    if (chosen !== undefined && chosen.fields.length > 0) {
      context.report(checkerDiagnostics.variantFields(node.span, name.text));
    }
    return chosen === undefined ? failed : variantLeaf(chosen);
  }
  if (entity !== undefined && patternTypeOf(context.checker, entity).kind !== 'none') {
    return typeLeaf(context, node, entity, part);
  }
  const constant = context.checker.constantNamed(context.module, name);
  if (constant === undefined) {
    if (entity !== undefined) {
      context.report(checkerDiagnostics.notPatternName(node.span, name.text));
    }
    return failed;
  }
  if (!comparable(constant.type, part.type)) {
    context.report(
      checkerDiagnostics.typeMismatch(node.span, typeText(part.type), typeText(constant.type)),
    );
  }
  const test: PatternTest = {
    kind: 'equal',
    path: part.path,
    value: { kind: 'constant', name },
    negated: false,
  };
  return { tests: [test], shape: undefined };
}

/**
 * A type pattern, the type `entity` named at `node`: it matches every value of its part, which
 * must be of that type, so nothing is tested and it covers the type (§3.11). A generic type takes
 * its type arguments from the part; a generic alias stands for no one type, so it names none.
 */
function typeLeaf(context: BodyContext, node: NamePattern, entity: Entity, part: ValuePart): Leaf {
  if (part.type.kind === 'error') {
    return failed;
  }
  if (namesOwnType(context.checker, entity, part.type)) {
    return { tests: [], shape: anyShape };
  }
  const named = { span: node.span, name: lastName(node.path) };
  context.report(otherTypeNamed(context.checker, entity, named, part.type));
  return failed;
}

/**
 * The variant `naming` names, written at `at`, among the variants of the part's enum; undefined
 * after a report, or for a part already in error.
 */
function namedVariant(
  context: BodyContext,
  at: NamePattern | (StructPattern['type'] & {}),
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

function variantLeaf({ test, key }: VariantPart): Leaf {
  return { tests: [test], shape: nullaryShape(key) };
}

function equalTest(part: ValuePart, value: Expression, negated: boolean): PatternTest {
  return { kind: 'equal', path: part.path, value: { kind: 'expression', node: value }, negated };
}
