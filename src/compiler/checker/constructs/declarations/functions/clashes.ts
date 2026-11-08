/**
 * Overload clashes (§3.3, §3.7): two functions of one name, or two static functions of one name
 * on one type, that some call fits alike with neither more specific are an error, since no call
 * could choose between them. What that means:
 *
 * - each parameter is by value or by `&` alike, except a method's `self`, since method notation
 *   passes it either way (§3.7);
 * - a call fits both where at every position one parameter's type holds the other's: a union holds
 *   each member, and a literal type's base the literal type, which a union holding both is (`"a" |
 *   String` is `String`). One function is more specific where its parameters' types are each held
 *   by the other's, and not all the same, which a call taking both then chooses (§3.7): `Int`
 *   beside `Int?`, `A` beside `A | B`. A type parameter may stand for the wider type, so where the
 *   two differ by one standing as a member (`T` beside `T?`), neither is narrower there. So two
 *   clash where neither is narrower anywhere, or each is somewhere;
 * - generic functions compare up to the names of their type parameters, so two with different
 *   numbers of them never clash: written type arguments tell them apart (§3.7);
 * - a function with defaults is compared for every number of arguments a call by position may give
 *   it, a rest parameter taking its element's type at every position past the fixed ones (§3.3,
 *   resolution/choosing/binding.ts), a pack's taking any type by value (§3.5); a function with a
 *   rest parameter never clashes with one without, since the one without wins a call both take
 *   (§3.7);
 * - a parameter's `fn(A) -> R` and `async fn(A) -> R` differ: a call fitting both takes the one
 *   that needs no plain function made async (§3.7, §3.14).
 *
 * Every number of arguments both take is compared: one function narrower at a parameter only a
 * longer call reaches, a default's or a rest's, may clash there though a shorter call prefers it.
 *
 * A module's functions are compared with each other and with the prelude's of the same name, which
 * they join (§3.13); a static function with the others declared on what its owner names, as
 * types/written/named-types.ts keys it, so an alias's are its type's (§3.17). A clash is reported
 * at the later declaration.
 */

import { addToGroup } from '../../../../../foundation/structures/groups.ts';
import { memo } from '../../../../../foundation/structures/memo.ts';
import type { ModuleId } from '../../../../program/program.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
  typeParametersOf,
} from '../../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { positionalCounts } from '../../../resolution/choosing/binding.ts';
import { signatureOf } from '../../../resolution/choosing/choice.ts';
import { mentionsError } from '../../../types/parts/type-parts.ts';
import type { RestSlot } from '../../../types/type/function-types.ts';
import type { ParameterKey, Type } from '../../../types/type/index.ts';
import { baseOf } from '../../../types/unions/union-members.ts';
import { membersOf } from '../../../types/unions/unions.ts';
import { declaredOwnerOf, type StaticOwner } from '../../../types/written/named-types.ts';

/** Reports every function of `module` that clashes with an earlier one, or with the prelude's. */
export function checkClashes(checker: CheckerContext, module: ModuleId): void {
  const groups = new Map<StaticOwner | undefined, Map<string, FunctionDeclaration[]>>();
  const functions = declaredFunctions({ items: checker.inputs.itemsOf(module) });
  // A static function whose owner names no type with statics belongs to none, so clashes with none.
  const owned = functions.flatMap((item) => {
    const owner = declaredOwnerOf(checker, module, item);
    return item.owner !== undefined && owner === undefined ? [] : [{ item, owner }];
  });
  for (const { item, owner } of owned) {
    const group = memo(groups, owner, () => new Map<string, FunctionDeclaration[]>());
    const earlier = group.get(item.name.text) ?? [];
    const shape = shapeOf(checker, item);
    const clashing = [...earlier, ...preludeOverloads(checker, module, item)].some((other) =>
      clash(shape, shapeOf(checker, other)),
    );
    if (clashing) {
      checker.report(module, checkerDiagnostics.overloadClash(item.name.span, item.name.text));
    }
    addToGroup(group, item.name.text, item);
  }
}

function preludeOverloads(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly FunctionDeclaration[] {
  return declaration.owner === undefined && module !== checker.inputs.role('prelude')
    ? checker.languageFunctions('prelude', declaration.name.text)
    : [];
}

/**
 * A parameter position as overload clash checking sees it: a pack's items taking any type by
 * value (§3.5), or the keys of a parameter's type's members, a literal member's with its base's,
 * with whether a call must pass it by `&`.
 */
type SlotKey =
  | { readonly kind: 'any' }
  | {
      readonly kind: 'type';
      readonly members: readonly MemberKey[];
      readonly reference: boolean;
    };

/**
 * A member of a parameter's type by its key, a literal member's base's key, and whether it is a
 * type parameter.
 */
interface MemberKey {
  readonly key: string;
  readonly base: string | undefined;
  readonly isParameter: boolean;
}

/**
 * What a call by position meets in a function: how many type parameters it has, the key of each
 * fixed parameter's type, its rest parameter's element's, and how many arguments it needs.
 */
interface Shape {
  readonly generic: number;
  readonly fixed: readonly SlotKey[];
  readonly rest: SlotKey | undefined;
  readonly minimum: number;
}

/** Whether some call by position fits both functions and no rule prefers one. */
function clash(first: Shape | undefined, second: Shape | undefined): boolean {
  if (first === undefined || second === undefined) {
    return false;
  }
  if (
    first.generic !== second.generic ||
    (first.rest === undefined) !== (second.rest === undefined)
  ) {
    return false;
  }
  // Past both functions' fixed parameters, every position takes a rest's items alike.
  const most = Math.min(
    first.rest === undefined ? first.fixed.length : Number.POSITIVE_INFINITY,
    second.rest === undefined ? second.fixed.length : Number.POSITIVE_INFINITY,
    Math.max(first.fixed.length, second.fixed.length) + 1,
  );
  for (let count = Math.max(first.minimum, second.minimum); count <= most; count += 1) {
    if (clashAt(count, first, second)) {
      return true;
    }
  }
  return false;
}

/** Whether a call of `count` arguments by position fits both functions with neither preferred. */
function clashAt(count: number, first: Shape, second: Shape): boolean {
  const keysAt = (shape: Shape) =>
    Array.from({ length: count }, (_, index) => shape.fixed[index] ?? shape.rest);
  const [firstKeys, secondKeys] = [keysAt(first), keysAt(second)];
  const everywhere = (holding: (key: SlotKey, other: SlotKey) => boolean) =>
    firstKeys.every((key, index) => {
      const other = secondKeys[index];
      return key !== undefined && other !== undefined && holding(key, other);
    });
  const overlap = everywhere((key, other) => keyHolds(key, other) || keyHolds(other, key));
  const narrower = (keys: readonly (SlotKey | undefined)[], others: typeof keys) =>
    keys.some((key, index) => {
      const other = others[index];
      return key !== undefined && other !== undefined && isNarrower(key, other);
    });
  return overlap && narrower(firstKeys, secondKeys) === narrower(secondKeys, firstKeys);
}

/**
 * Whether a parameter of `narrow` takes fewer arguments than one of `wide`, all of which `wide`
 * takes: never where a type parameter stands as a member of either, which may stand for the rest.
 */
function isNarrower(narrow: SlotKey, wide: SlotKey): boolean {
  if (!keyHolds(wide, narrow) || keyHolds(narrow, wide)) {
    return false;
  }
  const standsOpen = (key: SlotKey) =>
    key.kind === 'type' && key.members.some((member) => member.isParameter);
  return !(standsOpen(narrow) || standsOpen(wide));
}

/** The key a pack's items have at every position: they take any type by value (§3.5). */
const packItemKey: SlotKey = { kind: 'any' };

/** Whether every argument a parameter of `narrow` takes, one of `wide` takes alike. */
function keyHolds(wide: SlotKey, narrow: SlotKey): boolean {
  if (wide.kind === 'type' && narrow.kind === 'type') {
    return wide.reference === narrow.reference && holds(wide, narrow);
  }
  return wide.kind === 'any' && (narrow.kind === 'any' || !narrow.reference);
}

/**
 * Whether a value of each member of `narrow` is a value of `wide`: a member, or its literal's base.
 */
function holds(
  wide: Extract<SlotKey, { kind: 'type' }>,
  narrow: Extract<SlotKey, { kind: 'type' }>,
): boolean {
  const keys = new Set(wide.members.map(({ key }) => key));
  return narrow.members.every(
    ({ key, base }) => keys.has(key) || (base !== undefined && keys.has(base)),
  );
}

/**
 * The shape of `declaration`; undefined when a parameter type didn't resolve, which was reported
 * already, so it clashes with nothing.
 */
function shapeOf(checker: CheckerContext, declaration: FunctionDeclaration): Shape | undefined {
  const parameters = checker.parametersOf(declaration);
  if (parameters.some((parameter) => mentionsError(parameter.type))) {
    return undefined;
  }
  const positions = new Map<ParameterKey, number>(
    typeParametersOf(declaration.typeParameters).map((parameter, index) => [parameter, index]),
  );
  const key = (type: Type) => checker.typeKeys.typeKey(type, positions);
  const keyOf = (type: Type, reference: boolean): SlotKey => ({
    kind: 'type',
    members: membersOf(type).map((member) => ({
      key: key(member),
      base: member.kind === 'literal' ? key(baseOf(member)) : undefined,
      isParameter: member.kind === 'parameter',
    })),
    reference,
  });
  const slots = signatureOf(checker, declaration).parameters;
  const fixed = slots.filter((slot) => slot.rest === undefined);
  const rest = slots.find((slot) => slot.rest !== undefined)?.rest;
  // A method's `self` is passed either way, so it is keyed as by value.
  return {
    generic: positions.size,
    fixed: fixed.map((slot) => keyOf(slot.type, slot.reference && !slot.isReceiver)),
    rest: rest === undefined ? undefined : restKeyOf(rest, keyOf),
    minimum: positionalCounts(slots).minimum,
  };
}

/** The key of every item a rest parameter takes: an array's element's, or a pack's any type. */
function restKeyOf(rest: RestSlot, keyOf: (type: Type, reference: boolean) => SlotKey): SlotKey {
  return rest.kind === 'pack' ? packItemKey : keyOf(rest.item, false);
}
