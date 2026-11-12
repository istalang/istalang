/**
 * What a call through a requirement runs where the body making it can't name one witness
 * (design.md §5.4): through an `any` value, the witnesses of the required function among the types
 * the program puts into an `any` of its trait; on a union, each member's; on a computed type an
 * instantiation made known, its own. Each is checked where the call is made, with what it is
 * given, as a call of each would be.
 *
 * - **Per module, an entry** lists the values its bodies put into an `any`, by the `any` type and
 *   the value's type, read off each fitted copy's two types: a value put in whole, a union member
 *   by member as lowering puts it (`into-any.ts`), the parts of a value converted part by part,
 *   and a value going into a union holding an `any`. An edit keeping those leaves it equal.
 * - **Per trait, an entry** gathers each required function's witnesses over the modules that can
 *   name the trait: its own, and those importing it, directly, through others or through the
 *   prelude every module sees. Values of an `any` are only ever made by putting a value into it,
 *   so nothing else can run. A value of another `any` goes in as the values put into that one.
 * - **A value of a type not known yet** goes in only in a generic body, and each instantiation
 *   checks what it puts in against the declaration graph (symbolic.ts): it is no member here.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { FunctionCall, RequirementCall } from '../../surface/resolved-call.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
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

const sameConversions = sameItems<Conversion>(
  (first, second) =>
    sameTypeSpelled(first.to, second.to) && sameTypeSpelled(first.member, second.member),
);

export class Dispatch {
  readonly #checker: CheckerContext;
  readonly #conversions: EntryTable<CheckerNote, ModuleId, readonly Conversion[]>;
  readonly #witnesses: EntryTable<CheckerNote, TraitDeclaration, Witnesses>;
  readonly #named: EntryTable<CheckerNote, ModuleId, ReadonlySet<ModuleId>>;

  /** `flowsOf` gives every flow a module's bodies have, closures' included. */
  constructor(checker: CheckerContext, flowsOf: (module: ModuleId) => readonly FlowFunction[]) {
    this.#checker = checker;
    this.#conversions = checker.entries.table({
      name: 'conversions into any',
      compute: (module: ModuleId) =>
        flowsOf(module)
          .flatMap(conversionsIn)
          .filter(({ member }) => hasWitnesses(member)),
      equal: sameConversions,
    });
    this.#witnesses = checker.entries.table({
      name: 'dispatched witnesses',
      compute: (trait: TraitDeclaration) => this.#witnessesOf(trait),
      equal: sameWitnesses,
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
   * in; on a union, each member's; on a computed type made known, its own. Undefined where its
   * types aren't known yet: a type parameter's requirement, for an instantiation to close.
   */
  witnessesOf(call: RequirementCall): readonly FunctionCall[] | undefined {
    const { requirement } = call;
    if (requirement.kind === 'constraint') {
      const { on } = requirement;
      if (on.kind !== 'any') {
        return undefined;
      }
      const constraint = on.constraints[requirement.constraint];
      return constraint === undefined
        ? []
        : (this.#witnesses.get(constraint.trait).get(requirement.member) ?? []);
    }
    const members = requirement.kind === 'members' ? membersOf(requirement.on) : [requirement.on];
    return members.every(isKnown)
      ? members
          .filter(hasWitnesses)
          .flatMap((member) => this.#memberCall(requirement.through, member, requirement.member))
      : undefined;
  }

  /** The witnesses of `to`'s requirements a value of `member` put into it carries, all of them. */
  conversionWitnesses(to: AnyType, member: Type): readonly FunctionCall[] {
    if (!hasWitnesses(member)) {
      return [];
    }
    return [...to.constraints.keys()].flatMap((index) =>
      (this.#checker.traitObjects.memberWitnesses(to, index, member) ?? []).flatMap((call) =>
        call.kind === 'function' ? [call] : [],
      ),
    );
  }

  #witnessesOf(trait: TraitDeclaration): Witnesses {
    const declaring = this.#checker.moduleOf(trait);
    const conversions = this.#checker.inputs
      .modules()
      .filter((module) => this.#named.get(module).has(declaring))
      .flatMap((module) => this.#conversions.get(module));
    const calls = conversions.flatMap(({ to, member }) =>
      putInto(member, conversions, []).flatMap((each) =>
        [...to.constraints.entries()]
          .filter(([, constraint]) => constraint.trait === trait)
          .flatMap(([index]) => [
            ...(this.#checker.traitObjects.memberWitnesses(to, index, each) ?? []).entries(),
          ]),
      ),
    );
    const witnesses = new Map<number, FunctionCall[]>();
    for (const [position, call] of calls) {
      if (call.kind === 'function') {
        witnesses.set(position, [...(witnesses.get(position) ?? []), call]);
      }
    }
    return witnesses;
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
 * The values a value of `from` fitted to `to` puts into an `any`: itself, member by member, where
 * `to` is one; those its parts put into `to`'s, part by part, where the two are built alike; and
 * where `to` is a union, each member of `from` it doesn't hold as such, into each `any` it holds.
 */
export function anyConversionsBetween(from: Type, to: Type): readonly Conversion[] {
  if (to.kind === 'any') {
    return from.kind === 'any' && sameTypeSpelled(from, to)
      ? []
      : membersOf(from).map((member) => ({ to, member }));
  }
  if (to.kind === 'union') {
    const anys = to.members.filter((member): member is AnyType => member.kind === 'any');
    return membersOf(from).flatMap((member) =>
      to.members.some((each) => sameTypeSpelled(each, member))
        ? []
        : anys.flatMap((any) => anyConversionsBetween(member, any)),
    );
  }
  const [fromParts, toParts] = [typeChildren(from), typeChildren(to)];
  return from.kind === to.kind && fromParts.length === toParts.length
    ? fromParts.flatMap((part, index) => anyConversionsBetween(part, toParts[index] as Type))
    : [];
}

/** The values `flow` puts into an `any`, its nested functions' among them. */
function conversionsIn(flow: FlowFunction): readonly Conversion[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation): readonly Conversion[] => {
      if (operation.op === 'make' && operation.made.kind === 'closure') {
        return conversionsIn(operation.made.function);
      }
      if (operation.op !== 'copy' || operation.fit === undefined) {
        return [];
      }
      const from = flow.values[operation.from]?.type;
      const into = flow.values[operation.into]?.type;
      return from === undefined || into === undefined ? [] : anyConversionsBetween(from, into);
    }),
  );
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
