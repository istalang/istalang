/**
 * What a call through a requirement runs where the body making it can't name one witness
 * (design.md §5.4): through an `any` value, the witnesses of the required function among the types
 * the program puts into an `any` of its trait; on a union, each member's; on a computed type an
 * instantiation made known, its own. Each is checked where the call is made, with what it is
 * given, as a call of each would be.
 *
 * - **Per module, an entry** lists the values its bodies put into an `any`, by the `any` type and
 *   the value's type, as the checker fitted each copy: a value put in whole, a union member by
 *   member as lowering puts it (`into-any.ts`), the parts of a value converted part by part
 *   (types/fitting/part-pairs.ts), and a union's members going into a union holding an `any`. An
 *   edit keeping those leaves it equal.
 * - **Per trait, an entry** gathers each required function's witnesses over the modules that can
 *   name the trait: its own, and those importing it, directly, through others or through the
 *   prelude every module sees. Values of an `any` are only ever made by putting a value into it,
 *   so nothing else can run. A value of another `any` goes in as the values put into that one.
 * - **A value of a type not known yet** goes in only in a generic body, whose instantiations this
 *   rule doesn't follow: a trait some module puts one into is open, and a call through an `any`
 *   of it runs code nobody sees. The witnesses each instantiation gives are checked by types where
 *   the call instantiating it is made (analysis/calls.ts).
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { FunctionCall, RequirementCall } from '../../surface/resolved-call.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import { type PartRules, partPairs } from '../../types/fitting/part-pairs.ts';
import { UnfoldingPairs } from '../../types/identity/unfolding-pairs.ts';
import { isKnown, mentionsError, sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { type AnyType, membersOf, type Type } from '../../types/type/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';

/** A value put into an `any`: the `any` type, and the value's own type. */
export interface Conversion {
  readonly to: AnyType;
  readonly member: Type;
}

/** The witnesses of a trait's required functions, by their position in the trait. */
type Witnesses = ReadonlyMap<number, readonly FunctionCall[]>;

/** What a call through an `any` of a trait may run: its witnesses, or code not known here. */
type Dispatched =
  | { readonly kind: 'known'; readonly witnesses: Witnesses }
  | { readonly kind: 'open' };

const sameConversions = sameItems<Conversion>(
  (first, second) =>
    sameTypeSpelled(first.to, second.to) && sameTypeSpelled(first.member, second.member),
);

export class Dispatch {
  readonly #checker: CheckerContext;
  readonly #conversions: EntryTable<CheckerNote, ModuleId, readonly Conversion[]>;
  readonly #dispatched: EntryTable<CheckerNote, TraitDeclaration, Dispatched>;
  readonly #named: EntryTable<CheckerNote, ModuleId, ReadonlySet<ModuleId>>;

  /** `flowsOf` gives every flow a module's bodies have, closures' included. */
  constructor(checker: CheckerContext, flowsOf: (module: ModuleId) => readonly FlowFunction[]) {
    this.#checker = checker;
    this.#conversions = checker.entries.table({
      name: 'conversions into any',
      compute: (module: ModuleId) =>
        flowsOf(module)
          .flatMap((flow) => conversionsIn(checker, flow))
          .filter(({ member }) => !mentionsError(member)),
      equal: sameConversions,
    });
    this.#dispatched = checker.entries.table({
      name: 'dispatched witnesses',
      compute: (trait: TraitDeclaration) => this.#dispatchedOf(trait),
      equal: sameDispatched,
    });
    this.#named = checker.entries.table({
      name: 'modules named',
      compute: (module: ModuleId) => this.#modulesNamedBy(module),
      equal: (first, second) =>
        first.size === second.size && [...first].every((each) => second.has(each)),
    });
  }

  /**
   * The witnesses `call` runs where it is made: through an `any`, each the program may have put
   * in; on a union, each member's; on a computed type made known, its own. Undefined where they
   * can't be known here: a type parameter's requirement, or a call through an open trait's `any`.
   */
  witnessesOf(call: RequirementCall): readonly FunctionCall[] | undefined {
    const { requirement } = call;
    if (requirement.kind === 'constraint') {
      const { on } = requirement;
      if (on.kind !== 'any') {
        return undefined;
      }
      const constraint = on.constraints[requirement.constraint];
      if (constraint === undefined) {
        return [];
      }
      const dispatched = this.#dispatched.get(constraint.trait);
      return dispatched.kind === 'open'
        ? undefined
        : (dispatched.witnesses.get(requirement.member) ?? []);
    }
    const members = requirement.kind === 'members' ? membersOf(requirement.on) : [requirement.on];
    return members.every(isKnown)
      ? members
          .filter(hasWitnesses)
          .flatMap((member) => this.#memberCall(requirement.through, member, requirement.member))
      : undefined;
  }

  #dispatchedOf(trait: TraitDeclaration): Dispatched {
    const declaring = this.#checker.moduleOf(trait);
    const conversions = this.#checker.inputs
      .modules()
      .filter((module) => this.#named.get(module).has(declaring))
      .flatMap((module) => this.#conversions.get(module));
    const members = conversions
      .filter(({ to }) => to.constraints.some((constraint) => constraint.trait === trait))
      .flatMap(({ to, member }) => putInto(member, conversions, []).map((each) => ({ to, each })));
    if (members.some(({ each }) => !isKnown(each))) {
      return { kind: 'open' };
    }
    const calls = members.flatMap(({ to, each }) =>
      [...to.constraints.entries()]
        .filter(([, constraint]) => constraint.trait === trait)
        .flatMap(([index]) => [
          ...(this.#checker.traitObjects.memberWitnesses(to, index, each) ?? []).entries(),
        ]),
    );
    const witnesses = new Map<number, FunctionCall[]>();
    for (const [position, call] of calls) {
      if (call.kind === 'function') {
        witnesses.set(position, [...(witnesses.get(position) ?? []), call]);
      }
    }
    return { kind: 'known', witnesses };
  }

  /** The witness of `through`'s `position`-th required function a value of `member` has. */
  #memberCall(through: AnyType, member: Type, position: number): readonly FunctionCall[] {
    const call = this.#checker.traitObjects.memberWitnesses(through, 0, member)?.[position];
    return call?.kind === 'function' ? [call] : [];
  }

  /** The modules `module` can name what they declare in: itself, and those it imports, transitively. */
  #modulesNamedBy(module: ModuleId): ReadonlySet<ModuleId> {
    const { inputs } = this.#checker;
    const prelude = inputs.role('prelude');
    const named = new Set<ModuleId>();
    const pending = [module, ...(prelude === undefined ? [] : [prelude])];
    while (pending.length > 0) {
      const each = pending.pop() as ModuleId;
      if (!named.has(each)) {
        named.add(each);
        pending.push(...inputs.importedBy(each));
      }
    }
    return named;
  }
}

/**
 * Whether values of `type` carry witnesses the program gives: its types known, and no mistake in
 * it, which checking reported and which meets no trait.
 */
function hasWitnesses(type: Type): boolean {
  return isKnown(type) && !mentionsError(type);
}

/**
 * The types of the values a value of `member` may be: itself, but for an `any`, each put into one
 * spelled alike, unless `seen` has it already.
 */
function putInto(
  member: Type,
  conversions: readonly Conversion[],
  seen: readonly AnyType[],
): readonly Type[] {
  if (member.kind !== 'any') {
    return [member];
  }
  if (seen.some((each) => sameTypeSpelled(each, member))) {
    return [];
  }
  return conversions
    .filter(({ to }) => sameTypeSpelled(to, member))
    .flatMap((conversion) => putInto(conversion.member, conversions, [...seen, member]));
}

/**
 * The values a value of `from` fitted to `to` puts into an `any`, as the checker fits them
 * (`fitOf`): itself, member by member, where it converts into one; its parts, where it converts
 * part by part or into a shape (types/fitting/part-pairs.ts); a union's members, where it goes
 * into a union member by member. A pair met again while it is read puts nothing new in.
 */
function anyConversionsBetween(
  rules: PartRules,
  from: Type,
  to: Type,
  relating = new UnfoldingPairs(),
): readonly Conversion[] {
  return relating.relate(from, to, [], (value, place) => {
    const fit = rules.fitOf(value, place);
    return fit === undefined ? [] : fitConversions(rules, value, fit, relating);
  });
}

/** The values a value of `from` fitted as `fit` says puts into an `any`. */
function fitConversions(
  rules: PartRules,
  from: Type,
  { conversion, into }: Fit,
  relating: UnfoldingPairs,
): readonly Conversion[] {
  if (conversion.kind === 'any') {
    return membersOf(from).map((member) => ({ to: conversion.to, member }));
  }
  if (conversion.kind === 'parts' || conversion.kind === 'shape') {
    return partPairs(rules, from, conversion.to).flatMap(([part, target]) =>
      anyConversionsBetween(rules, part, target, relating),
    );
  }
  return conversion.kind === 'none' && into !== undefined && into.member === undefined
    ? membersOf(from).flatMap((member) =>
        anyConversionsBetween(rules, member, into.union, relating),
      )
    : [];
}

/** The values `flow` puts into an `any`, its nested functions' among them. */
function conversionsIn(rules: PartRules, flow: FlowFunction): readonly Conversion[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation): readonly Conversion[] => {
      if (operation.op === 'make' && operation.made.kind === 'closure') {
        return conversionsIn(rules, operation.made.function);
      }
      const from = operation.op === 'copy' ? flow.values[operation.from]?.type : undefined;
      return operation.op !== 'copy' || operation.fit === undefined || from === undefined
        ? []
        : fitConversions(rules, from, operation.fit, new UnfoldingPairs());
    }),
  );
}

function sameDispatched(first: Dispatched, second: Dispatched): boolean {
  return first.kind === 'known' && second.kind === 'known'
    ? sameWitnesses(first.witnesses, second.witnesses)
    : first.kind === second.kind;
}

function sameWitnesses(first: Witnesses, second: Witnesses): boolean {
  const sameCalls = sameItems<FunctionCall>(
    (one, other) =>
      one.function === other.function &&
      sameItems(sameTypeSpelled)(one.typeArguments, other.typeArguments),
  );
  return (
    first.size === second.size &&
    [...first].every(([position, calls]) => sameCalls(calls, second.get(position) ?? []))
  );
}
