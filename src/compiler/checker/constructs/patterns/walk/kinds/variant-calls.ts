/**
 * Call patterns (§3.11): `Ok(v)`, `Rejected(by: "legal")`, `Group(title, ...children)`. The
 * variant is tested first, as a struct pattern naming it is; then the arguments bind to its fields
 * as a call's bind to its constructor's parameters (resolution/choosing/binding.ts), so a value is
 * taken apart as it was built: by position in declared order, then by name, a spread starting the
 * rest field.
 *
 * - Only a variant is taken apart as a call: one naming anything else is reported before anything
 *   else is asked of it, in a target too, and then takes anything (`calledVariant`, walk/index.ts).
 * - One with nothing in its parentheses is warned of where it says no more than its name, a variant
 *   without fields, or less than it seems to, one whose fields all have defaults or are a rest,
 *   which `V(...)` matches whatever they hold.
 * - A field a call may leave out, one with a default or the rest, may be left out, and a last
 *   `...` leaves every field no argument gives: such a field matches any value. Any other must be
 *   given, as a call must give it.
 * - The arguments a call's rest field would collect match its items as an array pattern's do, its
 *   length included (arrays.ts), the call pattern standing as their site, and a last `...` leaves
 *   the items past them too; a lone spread takes the rest field whole, with nothing to test.
 * - Arguments that can't all bind are reported once. Each still takes the field it names or stands
 *   at where it can (`argumentsReach`, surface/struct-items.ts), so its field is recorded and its
 *   names bind at the field's type, else at the error type; the pattern then covers its variant
 *   whatever its fields hold, as a struct pattern naming a field its variant lacks does, so nothing
 *   more is reported around it.
 */

import type { Diagnostic } from '../../../../../../foundation/diagnostics/diagnostic.ts';
import { unreachable } from '../../../../../../foundation/structures/unreachable.ts';
import type { VariantNaming } from '../../../../../binder/entities.ts';
import { hasDefault, isRestField } from '../../../../../syntax/declarations/index.ts';
import type {
  NamedPatternArgument,
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
import { argumentsReach } from '../../../../surface/struct-items.ts';
import type { FieldMember } from '../../../../types/type/index.ts';
import { errorType } from '../../../../types/type/primitives.ts';
import { anyShape, type Shape } from '../../exhaustiveness/exhaustiveness.ts';
import type { PatternScope, ValuePart } from '../parts.ts';
import type { ArrayItems, PatternTests, VariantPart } from '../pattern-tests.ts';
import { constructed } from '../taking.ts';
import { type ItemTaking, takeArray } from './arrays.ts';

/** A call pattern's argument that binds to a field: any but a last `...`. */
type BoundPatternArgument = Exclude<PatternArgument, OtherFieldsPattern>;

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
  const { given, refused } = argumentsOf(node);
  const variant = tests.variant(node.callee, naming, part);
  for (const argument of variant === undefined ? [...given, ...refused] : refused) {
    walk.take(argument, { type: errorType, path: part.path });
  }
  if (variant === undefined) {
    return anyShape;
  }
  walk.found.push(variant.test);
  const leavesOthers = node.arguments.some(({ kind }) => kind === 'OtherFieldsPattern');
  // Past an argument the parser refused, no field is missing: it may have meant to give it.
  const slots = variant.fields.map((field) => slotOf(field, leavesOthers || refused.length > 0));
  if (node.arguments.length === 0) {
    warnEmpty(walk, node, slots);
  }
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

/**
 * Warns of a call pattern with nothing in its parentheses that says no more than its name, or less
 * than it seems to (§3.11): `case Expired()`, a variant without fields and no type arguments, is
 * `case Expired`, as its call is; `case List()`, whose fields a call may all leave out, matches
 * every `List`, not only the one its defaults build, which `List(...)` says.
 */
function warnEmpty(walk: ItemTaking, node: VariantCallPattern, slots: readonly BoundSlot[]): void {
  const { text } = lastName(node.callee.path);
  if (slots.length === 0) {
    if (node.callee.typeArguments.length === 0) {
      walk.scope.report(checkerDiagnostics.fieldlessCalled(node.span, text));
    }
  } else if (slots.every((slot) => slot.hasDefault || slot.rest !== undefined)) {
    walk.scope.report(checkerDiagnostics.defaultsCallPattern(node.span, text));
  }
}

/**
 * A call pattern's arguments as binding takes them: those it binds, and those the parser refused
 * (one it recovered, one by position after one by name, a second spread), which bind nothing, so
 * nothing more is reported of them; a last `...` is neither.
 */
function argumentsOf(node: VariantCallPattern): {
  readonly given: readonly BoundPatternArgument[];
  readonly refused: readonly BoundPatternArgument[];
} {
  const bound = node.arguments.filter(
    (argument): argument is BoundPatternArgument => argument.kind !== 'OtherFieldsPattern',
  );
  const named = bound.findIndex(({ kind }) => kind === 'NamedPatternArgument');
  const spread = bound.findIndex(({ kind }) => kind === 'RestPattern');
  const isRefused = (argument: BoundPatternArgument, index: number) =>
    argument.kind === 'Invalid' ||
    argument.kind === 'Missing' ||
    (argument.kind !== 'NamedPatternArgument' && named !== -1 && index > named) ||
    (argument.kind === 'RestPattern' && index !== spread);
  return {
    given: bound.filter((argument, index) => !isRefused(argument, index)),
    refused: bound.filter(isRefused),
  };
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
 * Each argument of `call`, which can't all bind, over the field it reaches (`argumentsReach`,
 * surface/struct-items.ts), its field recorded if it names it; one reaching none over the error
 * type.
 */
function takeReached(
  walk: ItemTaking,
  call: BoundCall,
  variant: VariantPart,
  part: ValuePart,
): void {
  const reached = argumentsReach(variant.fields, call.given);
  for (const [index, argument] of call.given.entries()) {
    const fieldReached = reached[index];
    // An item of the rest field is matched by no array test here: its names take the error type.
    const at = fieldReached?.isItem === false ? fieldReached.index : undefined;
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
      (argument): argument is NamedPatternArgument =>
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
      const byPosition = given.findIndex(({ kind }) => kind === 'RestPattern');
      const fixedGiven = byPosition === -1 ? positional.length : byPosition;
      const missing = slots.findIndex(
        (slot, index) => index >= fixedGiven && !slot.hasDefault && slot.rest === undefined,
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
