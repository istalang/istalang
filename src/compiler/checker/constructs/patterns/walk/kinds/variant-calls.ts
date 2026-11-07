/**
 * Call patterns (§3.11): `Ok(v)`, `Rejected(by: "legal")`, `Group(title, ...children)`. The
 * variant is tested first, as a struct pattern naming it is; then the arguments bind to its fields
 * as a call's bind to its constructor's parameters (resolution/choosing/binding.ts), so a value is
 * taken apart as it was built: by position in declared order, then by name, a spread starting the
 * rest field.
 *
 * - A field a call may leave out, one with a default or the rest, may be left out, and a last
 *   `...` leaves every field no argument gives: such a field matches any value. Any other must be
 *   given, as a call must give it.
 * - The arguments a call's rest field would collect match its items as an array pattern's do, its
 *   length included (arrays.ts), the call pattern standing as their site; a lone spread takes the
 *   rest field whole, with nothing to test.
 * - Arguments that can't bind are reported once, and each still binds its names, at the error type;
 *   the pattern then covers its variant whatever its fields hold, as a struct pattern naming a
 *   field its variant lacks does, so nothing more is reported of the cases around it.
 */

import type { Diagnostic } from '../../../../../../foundation/diagnostics/diagnostic.ts';
import { unreachable } from '../../../../../../foundation/structures/unreachable.ts';
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
import { typeText } from '../../../../types/type/type-text.ts';
import { anyShape, type Shape } from '../../exhaustiveness/exhaustiveness.ts';
import type { ValuePart } from '../parts.ts';
import type { ArrayItems, PatternTests, VariantPart } from '../pattern-tests.ts';
import { constructed } from '../taking.ts';
import { type ItemTaking, takeArray } from './arrays.ts';

/** A call pattern's argument that binds to a field: any but a last `...`. */
type BoundPatternArgument = Exclude<PatternArgument, OtherFieldsPattern>;

/** `node` over `part`: its variant's test, then each field against the argument bound to it. */
export function takeVariantCall(
  walk: ItemTaking,
  tests: PatternTests,
  node: VariantCallPattern,
  part: ValuePart,
): Shape | undefined {
  const name = lastName(node.callee.path);
  const naming = walk.scope.entityOf(name);
  const given = node.arguments.filter(
    (argument): argument is BoundPatternArgument => argument.kind !== 'OtherFieldsPattern',
  );
  if (naming?.kind !== 'variant' && naming?.kind !== 'variants') {
    if (naming !== undefined) {
      walk.scope.report(checkerDiagnostics.notVariantCalled(node.callee.span, name.text));
    }
    return takeUnbound(walk, given, part);
  }
  const variant = tests.variant(node.callee, naming, part);
  if (variant === undefined) {
    return takeUnbound(walk, given, part);
  }
  walk.found.push(variant.test);
  const leavesOthers = given.length < node.arguments.length;
  const slots = variant.fields.map((field) => slotOf(field, leavesOthers));
  const binding = bindArguments(slots, given.map(boundArgument));
  if (!isBinding(binding)) {
    walk.scope.report(failureReport({ node, given, slots, part }, variant, binding));
    takeUnbound(walk, given, part);
    return constructed(
      variant.key,
      variant.fields.map(() => anyShape),
    );
  }
  const shapes = variant.fields.map((field, index) =>
    takeField(
      walk,
      tests,
      { node, given, field, source: binding[index] },
      {
        type: field.type,
        path: [...part.path, index],
      },
    ),
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

/** A field of a call pattern's variant, and what its arguments give it. */
interface TakenField {
  readonly node: VariantCallPattern;
  readonly given: readonly BoundPatternArgument[];
  readonly field: FieldMember;
  readonly source: Binding[number] | undefined;
}

/** The field `taken` names over `part`: its argument, the rest's items, or anything when left. */
function takeField(
  walk: ItemTaking,
  tests: PatternTests,
  { node, given, field, source }: TakenField,
  part: ValuePart,
): Shape | undefined {
  switch (source?.kind) {
    case 'argument': {
      const argument = given[source.index];
      if (argument?.kind === 'NamedPatternArgument') {
        walk.scope.recordField(argument.name, field);
      }
      return argument === undefined ? anyShape : walk.take(argument, part);
    }
    case 'rest': {
      const items = source.items.flatMap(({ index }) => {
        const item = given[index];
        return item === undefined || item.kind === 'NamedPatternArgument' ? [] : [item];
      });
      return takeRestItems(walk, tests, { site: node, elements: items }, part);
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

/** Each argument over the error type, so its names bind with nothing more to report. */
function takeUnbound(
  walk: ItemTaking,
  given: readonly BoundPatternArgument[],
  part: ValuePart,
): Shape {
  for (const argument of given) {
    walk.take(argument, { type: errorType, path: part.path });
  }
  return anyShape;
}

/** A call pattern's arguments as bound: the pattern, what binds, the fields, and its part. */
interface BoundCall {
  readonly node: VariantCallPattern;
  readonly given: readonly BoundPatternArgument[];
  readonly slots: readonly BoundSlot[];
  readonly part: ValuePart;
}

/** The report saying why `call`'s arguments can't bind to `variant`'s fields. */
function failureReport(
  { node, given, slots, part }: BoundCall,
  variant: VariantPart,
  failure: BindingFailure,
): Diagnostic<AnchoredSpan> {
  const written = node.callee.path.map((name) => name.text).join('.');
  const positional = given.filter((argument) => argument.kind !== 'NamedPatternArgument');
  const namedAt = (field: string) =>
    given.find(
      (argument) => argument.kind === 'NamedPatternArgument' && argument.name.text === field,
    )?.span ?? node.span;
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
      return checkerDiagnostics.unknownField(
        namedAt(failure.name),
        typeText(part.type),
        failure.name,
      );
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
