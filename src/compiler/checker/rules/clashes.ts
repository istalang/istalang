/**
 * Overload clashes (§3.3, §3.7): two functions of one name, or two static functions of one name
 * on one type, whose parameters have the same types are an error, since no call could choose
 * between them. What "the same" means:
 *
 * - each parameter is by value or by `&` alike, except a method's `self`, since method notation
 *   passes it either way (§3.7);
 * - a parameter's type counts as the same as a union holding it, since the conversion into a union
 *   (§2) would make every call taking the narrower ambiguous: `T` and `T?`, `A` and `A | B`, and
 *   a literal type and its base, which a union holding both is (`"a" | String` is `String`);
 * - generic functions compare up to the names of their type parameters, so two with different
 *   numbers of them never clash: written type arguments tell them apart (§3.7);
 * - a function with defaults is compared for every number of arguments a call by position may give
 *   it, a rest parameter taking its element's type at every position past the fixed ones (§3.3,
 *   resolution/binding.ts), a pack's taking any type by value (§3.5); a function with a rest
 *   parameter never clashes with one without, since the one without wins a call both take (§3.7);
 * - a parameter's `fn(A) -> R` and `async fn(A) -> R` differ: a call fitting both takes the one that
 *   needs no plain function made async (§3.7, §3.14).
 *
 * Two functions agreeing at some number of arguments agree at every smaller one both take, so the
 * smallest number both take decides.
 *
 * A module's functions are compared with each other and with the prelude's of the same name, which
 * they join (§3.13); a static function with the others declared on what its owner names, as
 * types/named-types.ts keys it, so an alias's are its type's (§3.17). A clash is reported at the
 * later declaration.
 */

import { addToGroup } from '../../../structures/groups.ts';
import { memo } from '../../../structures/memo.ts';
import type { ModuleId } from '../../program/program.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { positionalCounts } from '../resolution/binding.ts';
import { signatureOf } from '../resolution/choice.ts';
import { declaredOwnerOf, type StaticOwner } from '../types/named-types.ts';
import type { ParameterKey, RestSlot, Type } from '../types/type.ts';
import { mentionsError } from '../types/type-parts.ts';
import { baseOf, membersOf } from '../types/unions.ts';

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

/** A member of a parameter's type by its key, and a literal member's base's key. */
interface MemberKey {
  readonly key: string;
  readonly base: string | undefined;
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
  const count = Math.max(first.minimum, second.minimum);
  const keysAt = (shape: Shape) =>
    Array.from({ length: count }, (_, index) => shape.fixed[index] ?? shape.rest);
  const [firstKeys, secondKeys] = [keysAt(first), keysAt(second)];
  return firstKeys.every((key, index) => {
    const other = secondKeys[index];
    return key !== undefined && other !== undefined && sameKey(key, other);
  });
}

/** The key a pack's items have at every position: they take any type by value (§3.5). */
const packItemKey: SlotKey = { kind: 'any' };

/** Whether a call's argument fits parameters of both keys alike. */
function sameKey(first: SlotKey, second: SlotKey): boolean {
  if (first.kind === 'type' && second.kind === 'type') {
    return first.reference === second.reference && (holds(first, second) || holds(second, first));
  }
  const takesAny = (key: SlotKey, other: SlotKey) =>
    key.kind === 'any' && (other.kind === 'any' || !other.reference);
  return takesAny(first, second) || takesAny(second, first);
}

/** Whether a value of each member of `narrow` is a value of `wide`: a member, or its literal's base. */
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
