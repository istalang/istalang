/**
 * Overload clashes (§3.3, §3.7): two functions of one name, or two static functions of one name
 * on one type, are an error when some call by position fits both and choosing
 * (resolution/choosing/choice.ts) prefers neither, since no such call could be resolved. So
 * whatever tells two functions apart at a call tells them apart here too: each argument passed by
 * value or by `&` as its parameter takes it, a method's `self` either way; one taking every
 * argument as it is beating one converting one (`fn(A)` beside `async fn(A)`, an element beside
 * its one-element tuple); the most specific, by the one order of types
 * (types/fitting/holds.ts), so `Int` beside `Int?` and `Array<Int>` beside `Array<Int?>`
 * coexist; one without a rest parameter beating one with.
 *
 * Generic functions with different numbers of type parameters never clash: written type arguments
 * tell them apart (§3.7). Otherwise each function's type parameters are its own, as at a call, so
 * `f<T>(x: T)` clashes with `f<T>(x: T?)` (a call giving an `Int?`), with `f<T>(x: Array<T>)` (one
 * giving an `Array<Int>`), and `f<T>(a: T, b: Int)` with `f<T>(a: Int, b: T)` (one giving two
 * `Int`s).
 *
 * The calls tried, for every number of arguments both take by position, counting defaults left out
 * and a rest's items (resolution/choosing/binding.ts): both functions' type parameters are first
 * given what makes each position's two parameter types alike where type arguments can, the same
 * type, else one taking the other's values; then one call per way of taking each argument's type
 * from one function's parameter or the other's. A pack's items take any type by value (§3.5). One
 * function preferred by a short call may still clash with another at a longer one, a default's or a
 * rest's.
 *
 * A module's functions are compared with each other and with the prelude's of the same name, which
 * they join (§3.13): what the prelude exports, never a private function or an import of its own; a
 * static function with the others declared on what its owner names, as
 * types/written/named-types.ts keys it, so an alias's are its type's (§3.17). A clash is reported
 * at the later declaration.
 */
import { addToGroup } from '../../../../../foundation/structures/groups.ts';
import { memo } from '../../../../../foundation/structures/memo.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { ModuleId } from '../../../../program/program.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { positionalCounts } from '../../../resolution/choosing/binding.ts';
import type {
  CallArgument,
  Passing,
  SignatureSlot,
} from '../../../resolution/choosing/call-arguments.ts';
import type { Candidate } from '../../../resolution/choosing/candidates.ts';
import { choose, signatureOf } from '../../../resolution/choosing/choice.ts';
import { sameType } from '../../../types/identity/identity.ts';
import { Inference } from '../../../types/inference/infer.ts';
import { mentionsError } from '../../../types/parts/type-parts.ts';
import type { RestSlot } from '../../../types/type/function-types.ts';
import type { Type } from '../../../types/type/index.ts';
import { unitType } from '../../../types/type/primitives.ts';
import { declaredOwnerOf, type StaticOwner } from '../../../types/written/named-types.ts';

/** Reports every function of `module` that clashes with an earlier one, or with the prelude's. */
export function checkClashes(checker: CheckerContext, module: ModuleId): void {
  const functions = declaredFunctions({ items: checker.inputs.itemsOf(module) });
  // A static function whose owner names no type with statics belongs to none, so clashes with none.
  const owned = functions.flatMap((item) => {
    const owner = declaredOwnerOf(checker, module, item);
    return item.owner !== undefined && owner === undefined ? [] : [{ item, owner }];
  });
  const groups = new Map<StaticOwner | undefined, Map<string, FunctionDeclaration[]>>();
  for (const { item, owner } of owned) {
    addToGroup(
      memo(groups, owner, () => new Map<string, FunctionDeclaration[]>()),
      item.name.text,
      item,
    );
  }
  const shapes = new Map<FunctionDeclaration, Shape | undefined>();
  const shape = (declaration: FunctionDeclaration) =>
    memo(shapes, declaration, () => shapeOf(checker, declaration));
  for (const { item, owner } of owned) {
    const declared = groups.get(owner)?.get(item.name.text) ?? [];
    const prelude = preludeOverloads(checker, module, item);
    // A call of the name may mean any of them, so any may be the one it prefers.
    const overloads = [...declared, ...prelude].map((declaration) => ({ declaration }));
    const earlier = [...declared.slice(0, declared.indexOf(item)), ...prelude];
    if (earlier.some((other) => clash(checker, shape(item), shape(other), overloads))) {
      checker.report(module, checkerDiagnostics.overloadClash(item.name.span, item.name.text));
    }
  }
}

function preludeOverloads(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly FunctionDeclaration[] {
  const prelude = checker.inputs.role('prelude');
  if (declaration.owner !== undefined || prelude === undefined || module === prelude) {
    return [];
  }
  const exported = checker.bindings.exportsOf(prelude).get(declaration.name.text);
  return exported?.kind === 'functions' ? checker.bindings.overloadsOf(exported) : [];
}

/**
 * A parameter position as a call by position meets it: a pack's items, taking any type by value
 * (§3.5), or a parameter's type with how an argument is passed to it.
 */
type Slot =
  | { readonly kind: 'pack' }
  | { readonly kind: 'type'; readonly type: Type; readonly passing: Passing };

/**
 * What a call by position meets in a function: the function, its type parameters, each fixed
 * parameter's slot, its rest parameter's items', and how many arguments it needs.
 */
interface Shape {
  readonly declaration: FunctionDeclaration;
  readonly typeParameters: readonly TypeParameter[];
  readonly fixed: readonly Slot[];
  readonly rest: Slot | undefined;
  readonly minimum: number;
}

/**
 * Whether some call by position fits both functions and choosing among `overloads`, every function
 * of their name, prefers neither, nor another over both.
 */
function clash(
  checker: CheckerContext,
  first: Shape | undefined,
  second: Shape | undefined,
  overloads: readonly Candidate[],
): boolean {
  if (
    first === undefined ||
    second === undefined ||
    first.typeParameters.length !== second.typeParameters.length
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
    const pairs = instantiatedPairs(checker, slotPairs(count, first, second), [
      ...first.typeParameters,
      ...second.typeParameters,
    ]);
    const tied = (callArguments: readonly CallArgument[]) => {
      const choice = choose(checker, overloads, callArguments, { site: {} });
      const isTied = (shape: Shape) =>
        choice.kind === 'several' &&
        choice.tied.some(({ candidate }) => candidate.declaration === shape.declaration);
      return isTied(first) && isTied(second);
    };
    if (mixedCalls(pairs).some(tied)) {
      return true;
    }
  }
  return false;
}

/**
 * The slots a call of `count` arguments by position meets in each function, position by position.
 */
function slotPairs(count: number, first: Shape, second: Shape): readonly SlotPair[] {
  const slotAt = (shape: Shape, index: number) =>
    shape.fixed[index] ??
    shape.rest ??
    unreachable('A call never passes more than a function takes.');
  return Array.from({ length: count }, (_, index) => [slotAt(first, index), slotAt(second, index)]);
}

type SlotPair = readonly [Slot, Slot];

/**
 * `pairs` with both functions' type parameters (`typeParameters`) given what makes each position's
 * two slots alike where type arguments can: the same type, else one taking the other's values.
 */
function instantiatedPairs(
  checker: CheckerContext,
  pairs: readonly SlotPair[],
  typeParameters: readonly TypeParameter[],
): readonly SlotPair[] {
  const inference = new Inference(typeParameters, checker.fitting);
  for (const [slot, other] of pairs) {
    if (slot.kind === 'type' && other.kind === 'type') {
      const [one, another] = [slot.type, other.type];
      const alike =
        inference.matchExactly(one, inference.open(another)) ||
        inference.match(one, inference.open(another));
      if (!alike) {
        inference.match(another, inference.open(one));
      }
    }
  }
  const instantiated = (slot: Slot): Slot =>
    slot.kind === 'pack' ? slot : { ...slot, type: inference.substituted(slot.type) };
  return pairs.map(([slot, other]) => [instantiated(slot), instantiated(other)]);
}

/**
 * Every call taking each argument from one of its position's two slots; a position whose slots
 * are the same type gives one.
 */
function mixedCalls(pairs: readonly SlotPair[]): readonly (readonly CallArgument[])[] {
  return pairs.reduce<(readonly CallArgument[])[]>(
    (calls, [slot, other]) => {
      const choices = isSameSlot(slot, other)
        ? [argumentFor(slot, other)]
        : [argumentFor(slot, other), argumentFor(other, slot)];
      return calls.flatMap((call) => choices.map((choice) => [...call, choice]));
    },
    [[]],
  );
}

/** The argument `slot` takes, one of `other`'s type for a pack, which takes any by value. */
function argumentFor(slot: Slot, other: Slot): CallArgument {
  if (slot.kind === 'type') {
    return { type: slot.type, passing: slot.passing };
  }
  return { type: other.kind === 'type' ? other.type : unitType, passing: 'value' };
}

/** Whether one argument stands for both slots: they take one type, passed one way. */
function isSameSlot(slot: Slot, other: Slot): boolean {
  return slot.kind === 'type' && other.kind === 'type'
    ? slot.passing === other.passing && sameType(slot.type, other.type)
    : slot.kind === other.kind;
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
  const slots = signatureOf(checker, declaration).parameters;
  const fixed = slots.filter((slot) => slot.rest === undefined);
  const rest = slots.find((slot) => slot.rest !== undefined)?.rest;
  return {
    declaration,
    typeParameters: typeParametersOf(declaration.typeParameters),
    fixed: fixed.map((slot) => ({ kind: 'type', type: slot.type, passing: passingOf(slot) })),
    rest: rest === undefined ? undefined : restSlotOf(rest),
    minimum: positionalCounts(slots).minimum,
  };
}

/** How a call passes an argument to `slot`: a method's `self` in method notation, either way. */
function passingOf(slot: SignatureSlot): Passing {
  if (slot.isReceiver) {
    return 'receiver';
  }
  return slot.reference ? 'reference' : 'value';
}

/** The slot of every item a rest parameter takes: an array's element's, or a pack's. */
function restSlotOf(rest: RestSlot): Slot {
  return rest.kind === 'pack' ? packSlot : { kind: 'type', type: rest.item, passing: 'value' };
}

const packSlot: Slot = { kind: 'pack' };
