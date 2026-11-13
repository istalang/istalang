/**
 * Struct comprehensions (§3.1, §4): `struct{id, for k, v in ...x: [k]: e}` gives each field of `x`
 * a field of its own, of `e`'s value as that field's pass checks it
 * (constructs/loops/field-passes.ts), after the fields the literal names. The literal gives every
 * field itself, so it has no spread and leaves no field to a default.
 *
 * - Its type is the expected one, a struct type with exactly the named fields and `x`'s, a
 *   declaration's (literal-fields/index.ts) or a type whose fields aren't all known yet, such as a
 *   mapped struct type over `x`'s keys, which a generic body builds. Without one, it is the shape
 *   of the named fields and each of `x`'s, typed as `e` is there: `x`'s fields must be known.
 * - A field the comprehension gives is a field the literal gives: a name the literal also gives,
 *   or one its type lacks, is a mistake as a repeated or unknown name is.
 * - Its source (surface/checked-body.ts `FieldSource`) is the comprehension itself, whose fields
 *   lowering finds on each instantiation's struct: what a generic body checks once, per named entry
 *   and once for the others, gives as many fields as the struct it is instantiated with has.
 */

import type {
  FieldItem,
  FieldsLiteral,
  StructComprehension,
  StructLiteral,
} from '../../../../syntax/expressions/index.ts';
import { itemValue } from '../../../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext, CheckedPasses } from '../../../contexts/body-context.ts';
import type { FieldPassType } from '../../../contexts/passes.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { FieldSource } from '../../../surface/checked-body.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { Inference } from '../../../types/inference/infer.ts';
import { type Substitution, substitute } from '../../../types/parts/substitution.ts';
import { parametersIn } from '../../../types/parts/type-parts.ts';
import type { FieldMember, Type } from '../../../types/type/index.ts';
import { literalType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { unionOf } from '../../../types/unions/unions.ts';
import { checkedFieldPasses, inFieldPasses } from '../../loops/field-passes.ts';
import type { LiteralGiven } from './literal-sources.ts';

/** The struct comprehension ending `node`'s items, if it has one. */
export function comprehensionOf(node: FieldsLiteral): StructComprehension | undefined {
  return node.items.find((item) => item.kind === 'StructComprehension');
}

/** The source a struct comprehension is of every field it gives. */
function comprehensionSource(comprehension: StructComprehension): FieldSource {
  return { kind: 'comprehension', comprehension };
}

/** What a literal builds, as its comprehension's fields are checked against it. */
interface ComprehensionTarget {
  /** Its fields, as declared, and the name of the literal, for reports. */
  readonly fields: readonly FieldMember[];
  readonly name: string;
  readonly inference: Inference;
  /** Whether the literal's named items give the field at `index` already. */
  readonly isGiven: (index: number) => boolean;
}

/**
 * A field a comprehension's pass gives: its position, its value's type, and its type as declared.
 */
interface ComprehendedField {
  readonly index: number;
  readonly type: Type;
  readonly declared: Type;
}

/**
 * What a comprehension gave a literal of declared fields: by pass, the field each gives, if any.
 */
export interface Comprehended {
  readonly node: StructComprehension;
  readonly passes: CheckedPasses;
  readonly given: readonly (ComprehendedField | undefined)[];
}

/**
 * Checks the value of the comprehension `literal` ends with, if any, once per pass against the
 * field of `target` the pass's field is, as a named item's value is (literal-fields/index.ts),
 * matching it for inference where its type isn't known yet.
 */
export function checkComprehended(
  context: BodyContext,
  literal: FieldsLiteral,
  target: ComprehensionTarget,
): Comprehended | undefined {
  const node = comprehensionOf(literal);
  if (node === undefined) {
    return undefined;
  }
  const given: (ComprehendedField | undefined)[] = [];
  const passes = inFieldPasses(
    context,
    node.header,
    checkedFieldPasses(context, node.header),
    (pass) => given.push(comprehendedField(context, node, target, pass)),
  );
  return { node, passes, given };
}

function comprehendedField(
  context: BodyContext,
  node: StructComprehension,
  { fields, name, inference, isGiven }: ComprehensionTarget,
  pass: FieldPassType,
): ComprehendedField | undefined {
  const { visits } = pass;
  const index =
    visits.kind === 'field' ? fields.findIndex((each) => each.name === visits.name) : -1;
  const field = fields[index];
  if (visits.kind !== 'field' || field === undefined || isGiven(index)) {
    const subject = context.typeOf(node.header.subject);
    if (visits.kind === 'others') {
      context.report(
        checkerDiagnostics.comprehendedFieldsUnknown(node.key.span, typeText(subject)),
      );
    } else if (visits.kind === 'field') {
      context.report(
        field === undefined
          ? checkerDiagnostics.unknownField(node.key.span, name, visits.name)
          : checkerDiagnostics.repeatedField(node.key.span, visits.name),
      );
    }
    context.expression(node.value);
    return undefined;
  }
  const declared = inference.settledIn(field.type);
  const isKnown = parametersIn(declared).every((parameter) => !inference.isUnknown(parameter));
  const type = context.expression(node.value, isKnown ? declared : undefined);
  if (!isKnown) {
    inference.match(field.type, type);
  }
  return { index, type, declared: field.type };
}

/** Fits each pass's value to its field, `substitution` giving the literal's type arguments. */
export function fitComprehended(
  context: BodyContext,
  comprehended: Comprehended | undefined,
  substitution: Substitution,
): void {
  if (comprehended === undefined) {
    return;
  }
  const { node, passes, given } = comprehended;
  passes.inEach((_, index) => {
    const field = given[index];
    if (field !== undefined) {
      const declared = substitute(field.declared, substitution, context.checker.typeRules);
      context.fit(field.type, declared, node.value);
    }
  });
}

/**
 * The comprehension, if any, and the positions of the fields it gives, which its literal's sources
 * leave to it.
 */
export function comprehendedGiven(
  comprehended: Comprehended | undefined,
): LiteralGiven['comprehended'] {
  if (comprehended === undefined) {
    return undefined;
  }
  const { node, given } = comprehended;
  return {
    node,
    indices: new Set(given.flatMap((field) => (field === undefined ? [] : [field.index]))),
  };
}

/**
 * What a `struct{…}` with nothing to take a type from gets of the comprehension it ends with, if
 * any, after the fields its items name: a field of each of its subject's, typed as its value is
 * there, and the comprehension as their source; undefined after a report, as for a subject whose
 * fields aren't all known.
 */
export function freshComprehended(
  context: BodyContext,
  literal: StructLiteral,
  named: ReadonlySet<string>,
):
  | { readonly fields: readonly FieldMember[]; readonly sources: readonly FieldSource[] }
  | undefined {
  const node = comprehensionOf(literal);
  if (node === undefined) {
    return { fields: [], sources: [] };
  }
  const fields: (FieldMember | undefined)[] = [];
  inFieldPasses(context, node.header, checkedFieldPasses(context, node.header), (pass) => {
    const type = context.expression(node.value);
    const { visits } = pass;
    if (visits.kind === 'others') {
      const subject = typeText(context.typeOf(node.header.subject));
      context.report(checkerDiagnostics.comprehendedFieldsUnknown(node.key.span, subject));
      fields.push(undefined);
    } else if (visits.kind === 'field') {
      const given = named.has(visits.name);
      if (given) {
        context.report(checkerDiagnostics.repeatedField(node.key.span, visits.name));
      }
      fields.push(given ? undefined : { name: visits.name, type });
    }
  });
  return fields.every((field) => field !== undefined)
    ? { fields, sources: [comprehensionSource(node)] }
    : undefined;
}

/**
 * Checks a comprehension's value in each pass with nothing expected, its literal's type unknown.
 */
export function checkComprehensionAlone(context: BodyContext, node: StructComprehension): void {
  const passes = checkedFieldPasses(context, node.header);
  inFieldPasses(context, node.header, passes, () => context.expression(node.value));
}

/** Whether `named` keys and those of `subject`, a comprehension's, are exactly `target`'s. */
function givesKeysOf(
  context: BodyContext,
  named: readonly Type[],
  subject: Type,
  target: Type,
): boolean {
  const { typeRules: rules } = context.checker;
  return sameType(unionOf([...named, rules.keysOf(subject, [])], rules), rules.keysOf(target, []));
}

/**
 * A `struct{…}` ending in a comprehension, building `expected`, a struct type whose fields aren't
 * all known: each named item's value checked against the field it names, each pass's against the
 * field its key names, and the keys of both together exactly `expected`'s. Its type is `expected`.
 */
export function checkOpaqueComprehended(
  context: BodyContext,
  node: StructLiteral,
  comprehension: StructComprehension,
  expected: Type,
): Type {
  const { typeRules: rules } = context.checker;
  const named = checkNamedOf(context, node, expected);
  let { fits } = named;
  const passes = checkedFieldPasses(context, comprehension.header);
  inFieldPasses(context, comprehension.header, passes, (pass) => {
    const { visits } = pass;
    if (visits.kind === 'none') {
      context.expression(comprehension.value);
      return;
    }
    if (
      visits.kind === 'field' &&
      named.keys.some((key) => sameType(key, literalType(visits.name)))
    ) {
      context.report(checkerDiagnostics.repeatedField(comprehension.key.span, visits.name));
      fits = false;
    }
    context.expect(comprehension.value, rules.fieldType(expected, pass.key));
  });
  const subject = context.typeOf(comprehension.header.subject);
  if (subject.kind !== 'error' && !givesKeysOf(context, named.keys, subject, expected)) {
    context.report(checkerDiagnostics.comprehendedFields(node.span, typeText(expected)));
  } else if (fits) {
    context.literals.record(node, [...named.sources, comprehensionSource(comprehension)]);
  }
  return expected;
}

/**
 * What a literal's named items give a type whose fields aren't all known: their keys and sources.
 */
interface NamedGiven {
  readonly keys: readonly Type[];
  readonly sources: readonly FieldSource[];
  /** Whether every item gave a field of its own. */
  readonly fits: boolean;
}

/** Checks each named item of `node` against the field of `expected` it names. */
function checkNamedOf(context: BodyContext, node: StructLiteral, expected: Type): NamedGiven {
  const keys: Type[] = [];
  const sources: FieldSource[] = [];
  let fits = true;
  for (const item of node.items) {
    if (item.kind === 'PositionalInitializer' || item.kind === 'Spread') {
      context.expression(item.kind === 'Spread' ? item.expression : item.value);
      fits = false;
    } else if (item.kind === 'FieldInitializer') {
      const key = checkNamedItem(context, item, expected, keys);
      if (key === undefined) {
        fits = false;
      } else {
        keys.push(key);
        sources.push({ field: item.name.text, kind: 'value', value: itemValue(item) });
      }
    }
  }
  return { keys, sources, fits };
}

/**
 * Checks `item` against the field of `expected` it names, after `keys`; its key, unless reported.
 */
function checkNamedItem(
  context: BodyContext,
  item: Extract<FieldItem, { readonly kind: 'FieldInitializer' }>,
  expected: Type,
  keys: readonly Type[],
): Type | undefined {
  const key = literalType(item.name.text);
  const type = context.checker.typeRules.fieldType(expected, key);
  const value = itemValue(item);
  if (type.kind === 'error' || keys.some((each) => sameType(each, key))) {
    const report = type.kind === 'error' ? unknownNamed : checkerDiagnostics.repeatedField;
    context.report(report(item.name.span, item.name.text));
    context.expression(value);
    return undefined;
  }
  context.recordField(item.name, { name: item.name.text, type });
  context.expect(value, type);
  return key;
}

/** A named item naming no field of an anonymous literal's type. */
function unknownNamed(span: AnchoredSpan, name: string) {
  return checkerDiagnostics.unknownField(span, 'struct', name);
}
