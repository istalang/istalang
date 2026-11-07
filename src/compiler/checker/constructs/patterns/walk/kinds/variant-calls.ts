/**
 * Call patterns (§3.11): `Ok(v)`, `Rejected(by: "legal")`, `Group(title, ...children)`. The
 * variant is tested first, as a struct pattern naming it is; then the arguments bind to its fields
 * as a call's bind to its constructor's parameters (resolution/choosing/binding.ts), so a value is
 * taken apart as it was built: by position in declared order, then by name, a spread starting the
 * rest field.
 *
 * - Only a variant is taken apart as a call: one naming anything else is reported before anything
 *   else is asked of it, in a target too, and then takes anything (`calledVariant`, walk/index.ts).
 * - A field a call may leave out, one with a default or the rest, may be left out, and a last
 *   `...` leaves every field no argument gives: such a field matches any value. Any other must be
 *   given, as a call must give it.
 * - The arguments a call's rest field would collect match its items as an array pattern's do, its
 *   length included (arrays.ts), the call pattern standing as their site, and a last `...` leaves
 *   the items past them too; a lone spread takes the rest field whole, with nothing to test.
 * - Arguments that can't all bind are reported once. Each still takes the field it names or stands
 *   at where it can (`fieldsReached`), so its field is recorded and its names bind at the field's
 *   type, else at the error type; the pattern then covers its variant whatever its fields hold, as
 *   a struct pattern naming a field its variant lacks does, so nothing more is reported around it.
 */

import type { Diagnostic } from '../../../../../../foundation/diagnostics/diagnostic.ts';
import { unreachable } from '../../../../../../foundation/structures/unreachable.ts';
import type { VariantNaming } from '../../../../../binder/entities.ts';
import { hasDefault, isRestField } from '../../../../../syntax/declarations/index.ts';
import type {
  OtherFieldsPattern,
  PatternArgument,
  VariantCallPattern,
} from '../../../../../syntax/patterns.ts';
import { lastName } from '../../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../../syntax/tree/positions.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import {
  type BindingFailure,
  type BoundSlot,
  bindArguments,
  isBinding,
} from '../../../../resolution/choosing/binding.ts';
import type { Binding } from '../../../../surface/resolved-call.ts';
import type { FieldMember } from '../../../../types/type/index.ts';
import { errorType } from '../../../../types/type/primitives.ts';
import { anyShape, type Shape } from '../../exhaustiveness/exhaustiveness.ts';
import type { PatternScope, ValuePart } from '../parts.ts';
import type { ArrayItems, PatternTests, VariantPart } from '../pattern-tests.ts';
import { constructed } from '../taking.ts';
import { type ItemTaking, takeArray } from './arrays.ts';

/** A call pattern's argument that binds to a field: any but a last `...`. */
type BoundPatternArgument = Exclude<PatternArgument, OtherFieldsPattern>;

type NamedArgument = Extract<PatternArgument, { readonly kind: 'NamedPatternArgument' }>;

/**
 * The variant `node` names; undefined after reporting that it names something else, or for a name
 * naming nothing, which binding reported.
 */
export function calledVariant(
  scope: PatternScope,
  node: VariantCallPattern,
): VariantNaming | undefined {
  const name = lastName(node.callee.path);
  const naming = scope.entityOf(name);
  if (naming?.kind === 'variant' || naming?.kind === 'variants') {
    return naming;
  }
  if (naming !== undefined) {
    scope.report(checkerDiagnostics.notVariantCalled(node.callee.span, name.text));
  }
  return undefined;
}

/** A call pattern as its arguments bind: the pattern, what binds, and the fields as slots. */
interface BoundCall {
  readonly node: VariantCallPattern;
  readonly given: readonly BoundPatternArgument[];
  readonly slots: readonly BoundSlot[];
  /** Whether a last `...` leaves what no argument gives. */
  readonly leavesOthers: boolean;
}

/**
 * `node`, naming a variant, over `part`: its variant's test, then each field against the argument
 * bound to it.
 */
export function takeVariantCall(
  walk: ItemTaking,
  tests: PatternTests,
  node: VariantCallPattern,
  part: ValuePart,
): Shape | undefined {
  const naming = walk.scope.entityOf(lastName(node.callee.path));
  if (naming?.kind !== 'variant' && naming?.kind !== 'variants') {
    return unreachable('A call pattern naming no variant is refused before it is taken.');
  }
  const given = node.arguments.filter(
    (argument): argument is BoundPatternArgument => argument.kind !== 'OtherFieldsPattern',
  );
  const variant = tests.variant(node.callee, naming, part);
  if (variant === undefined) {
    for (const argument of given) {
      walk.take(argument, { type: errorType, path: part.path });
    }
    return anyShape;
  }
  walk.found.push(variant.test);
  const leavesOthers = given.length < node.arguments.length;
  const slots = variant.fields.map((field) => slotOf(field, leavesOthers));
  const call: BoundCall = { node, given, slots, leavesOthers };
  const binding = bindArguments(slots, given.map(boundArgument));
  if (!isBinding(binding)) {
    walk.scope.report(failureReport(call, variant, binding));
    takeReached(walk, call, variant, part);
    return constructed(
      variant.key,
      variant.fields.map(() => anyShape),
    );
  }
  const shapes = variant.fields.map((field, index) =>
    takeField(walk, tests, { call, field, source: binding[index] }, fieldPart(part, field, index)),
  );
  return constructed(variant.key, shapes);
}

/** The parameter a field is to a call pattern's arguments: one it may leave out, if `leaves`. */
function slotOf(field: FieldMember, leaves: boolean): BoundSlot {
  const declared = field.declared?.node;
  const isRest = declared !== undefined && isRestField(declared);
  return {
    name: field.name,
    hasDefault: leaves || (declared !== undefined && hasDefault(declared)),
    rest: isRest ? { kind: 'array' } : undefined,
  };
}

function boundArgument(argument: BoundPatternArgument) {
  return {
    name: argument.kind === 'NamedPatternArgument' ? argument.name.text : undefined,
    isSpread: argument.kind === 'RestPattern',
  };
}

/** The part of a variant's value of `part` its `index`-th field, `field`, holds. */
function fieldPart(part: ValuePart, field: FieldMember, index: number): ValuePart {
  return { type: field.type, path: [...part.path, index] };
}

/** A field of a call pattern's variant, and what its arguments give it. */
interface TakenField {
  readonly call: BoundCall;
  readonly field: FieldMember;
  readonly source: Binding[number] | undefined;
}

/** The field `taken` names over `part`: its argument, the rest's items, or anything when left. */
function takeField(
  walk: ItemTaking,
  tests: PatternTests,
  { call, field, source }: TakenField,
  part: ValuePart,
): Shape | undefined {
  switch (source?.kind) {
    case 'argument': {
      const argument = call.given[source.index];
      if (argument?.kind === 'NamedPatternArgument') {
        walk.scope.recordField(argument.name, field);
      }
      return argument === undefined ? anyShape : walk.take(argument, part);
    }
    case 'rest': {
      const elements = source.items.flatMap(({ index }) => {
        const item = call.given[index];
        return item === undefined || item.kind === 'NamedPatternArgument' ? [] : [item];
      });
      const items = { site: call.node, elements, isOpen: call.leavesOthers };
      return takeRestItems(walk, tests, items, part);
    }
    default:
      return anyShape;
  }
}

/**
 * The rest field of `part` against the arguments it collects, `items` at their call pattern:
 * anything for none, a lone spread taking it whole, else its items as an array pattern's.
 */
function takeRestItems(
  walk: ItemTaking,
  tests: PatternTests,
  items: ArrayItems,
  part: ValuePart,
): Shape | undefined {
  const [only] = items.elements;
  if (only === undefined) {
    return anyShape;
  }
  if (items.elements.length === 1 && only.kind === 'RestPattern') {
    return walk.take(only, part);
  }
  return takeArray(walk, tests, items, part);
}

/**
 * Each argument of `call`, which can't all bind, over the field it reaches (`fieldsReached`), its
 * field recorded if it names it; one reaching none over the error type.
 */
function takeReached(
  walk: ItemTaking,
  call: BoundCall,
  variant: VariantPart,
  part: ValuePart,
): void {
  const reached = fieldsReached(call);
  for (const [index, argument] of call.given.entries()) {
    const at = reached[index];
    const field = at === undefined ? undefined : variant.fields[at];
    if (at === undefined || field === undefined) {
      walk.take(argument, { type: errorType, path: part.path });
    } else {
      if (argument.kind === 'NamedPatternArgument') {
        walk.scope.recordField(argument.name, field);
      }
      walk.take(argument, fieldPart(part, field, at));
    }
  }
}

/**
 * By argument, the field each of `call`'s arguments reaches though they can't all bind: a fixed
 * field its position gives, before any spread; the rest field, for the first spread; the field a
 * name names, unless an earlier argument took it. Any other reaches none.
 */
function fieldsReached({ slots, given }: BoundCall): readonly (number | undefined)[] {
  const restAt = slots.findIndex((slot) => slot.rest !== undefined);
  const fixed = restAt === -1 ? slots.length : restAt;
  const spreadAt = given.findIndex((argument) => argument.kind === 'RestPattern');
  const positional = given.filter(
    (argument, index) =>
      argument.kind !== 'NamedPatternArgument' && (spreadAt === -1 || index < spreadAt),
  );
  const byPosition = Math.min(positional.length, fixed);
  return given.map((argument, index) => {
    if (argument.kind === 'NamedPatternArgument') {
      const field = slots.findIndex((slot) => slot.name === argument.name.text);
      const first = given.findIndex(
        (other) => other.kind === 'NamedPatternArgument' && other.name.text === argument.name.text,
      );
      return field === -1 || field < byPosition || first !== index ? undefined : field;
    }
    if (index === spreadAt) {
      return restAt === -1 ? undefined : restAt;
    }
    const at = positional.indexOf(argument);
    return at === -1 || at >= fixed ? undefined : at;
  });
}

/** The report saying why `call`'s arguments can't bind to `variant`'s fields. */
function failureReport(
  { node, given, slots }: BoundCall,
  variant: VariantPart,
  failure: BindingFailure,
): Diagnostic<AnchoredSpan> {
  const written = node.callee.path.map((name) => name.text).join('.');
  const positional = given.filter((argument) => argument.kind !== 'NamedPatternArgument');
  // The last argument naming the field: the one a field given before it is given twice by.
  const namedAt = (field: string) =>
    given.findLast(
      (argument): argument is NamedArgument =>
        argument.kind === 'NamedPatternArgument' && argument.name.text === field,
    )?.name.span ?? node.span;
  switch (failure.kind) {
    case 'arity': {
      const extra = positional[failure.maximum];
      if (extra !== undefined) {
        return checkerDiagnostics.callPatternArity(
          extra.span,
          written,
          failure.maximum,
          positional.length,
        );
      }
      const missing = slots.findIndex(
        (slot, index) => index >= positional.length && !slot.hasDefault && slot.rest === undefined,
      );
      return checkerDiagnostics.callPatternMissing(
        node.span,
        written,
        variant.fields[missing]?.name ?? '',
      );
    }
    case 'missing':
      return checkerDiagnostics.callPatternMissing(node.span, written, failure.name);
    case 'unnamed':
      return checkerDiagnostics.unknownField(namedAt(failure.name), written, failure.name);
    case 'twice':
      return checkerDiagnostics.callPatternTwice(namedAt(failure.name), failure.name);
    case 'spread': {
      const spread = given.find((argument) => argument.kind === 'RestPattern');
      return checkerDiagnostics.callPatternSpread(spread?.span ?? node.span, written);
    }
    case 'packNamed':
      return unreachable('A variant has no pack to name.');
    default: {
      const unhandled: never = failure;
      return unhandled;
    }
  }
}
