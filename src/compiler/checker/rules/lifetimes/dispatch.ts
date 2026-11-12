/**
 * What a call through an `any` value may run (design.md §5.4): the witnesses of the required
 * function among the types the program puts into an `any` of its trait, so the call is checked
 * where it is made, with what it is given, as a call of each would be.
 *
 * - **Per module, an entry** lists the values its bodies put into an `any`, by the `any` type and
 *   the value's type; an edit keeping those leaves it equal, so nothing reading it runs again.
 * - **Per trait, an entry** gathers each required function's witnesses over the modules that can
 *   name the trait: its own, and those importing it, directly, through others or through the
 *   prelude every module sees. Values of an `any` are only ever made by putting a value into it,
 *   so nothing else can run.
 * - **A value of a type not known yet** (a type parameter's, one computed from it) going in makes
 *   the trait's calls through `any` code nobody sees: what goes in is its instantiations' to say.
 * - **A union goes in member by member,** as lowering puts it (`into-any.ts`), and a value of
 *   another `any` goes in as the values put into that one.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { FunctionCall, RequirementCall } from '../../surface/resolved-call.ts';
import { isKnown, sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { AnyType, Type } from '../../types/type/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';

/** A value put into an `any`: the `any` type, and the value's own type. */
export interface Conversion {
  readonly to: AnyType;
  readonly member: Type;
}

/**
 * What a call through an `any` of a trait may run: the witnesses of each required function, by
 * its position in the trait, or anything, where a value of a type not known yet goes in.
 */
type Dispatched =
  | { readonly kind: 'known'; readonly witnesses: ReadonlyMap<number, readonly FunctionCall[]> }
  | { readonly kind: 'open' };

const sameConversions = sameItems<Conversion>(
  (first, second) =>
    sameTypeSpelled(first.to, second.to) && sameTypeSpelled(first.member, second.member),
);

export class Dispatch {
  readonly #checker: CheckerContext;
  readonly #conversions: EntryTable<CheckerNote, ModuleId, readonly Conversion[]>;
  readonly #witnesses: EntryTable<CheckerNote, TraitDeclaration, Dispatched>;
  readonly #named: EntryTable<CheckerNote, ModuleId, ReadonlySet<ModuleId>>;

  /** `flowsOf` gives every flow a module's bodies have, closures' included. */
  constructor(checker: CheckerContext, flowsOf: (module: ModuleId) => readonly FlowFunction[]) {
    this.#checker = checker;
    this.#conversions = checker.entries.table({
      name: 'conversions into any',
      compute: (module: ModuleId) => flowsOf(module).flatMap(conversionsIn),
      equal: sameConversions,
    });
    this.#witnesses = checker.entries.table({
      name: 'dispatched witnesses',
      compute: (trait: TraitDeclaration) => this.#witnessesOf(trait),
      equal: sameDispatched,
    });
    this.#named = checker.entries.table({
      name: 'modules named',
      compute: (module: ModuleId) => this.#modulesNamedBy(module),
      equal: (first, second) =>
        first.size === second.size && [...first].every((each) => second.has(each)),
    });
  }

  /** What `call` may run, where it is a call through an `any` value; else undefined. */
  dispatched(call: RequirementCall): readonly FunctionCall[] | undefined {
    const { requirement } = call;
    if (requirement.kind !== 'constraint' || requirement.on.kind !== 'any') {
      return undefined;
    }
    const constraint = requirement.on.constraints[requirement.constraint];
    if (constraint === undefined) {
      return undefined;
    }
    const dispatched = this.#witnesses.get(constraint.trait);
    return dispatched.kind === 'open'
      ? undefined
      : (dispatched.witnesses.get(requirement.member) ?? []);
  }

  #witnessesOf(trait: TraitDeclaration): Dispatched {
    const declaring = this.#checker.moduleOf(trait);
    const conversions = this.#checker.inputs
      .modules()
      .filter((module) => this.#named.get(module).has(declaring))
      .flatMap((module) => this.#conversions.get(module));
    const members = conversions.flatMap(({ to, member }) =>
      putInto(member, conversions, []).map((each) => ({ to, member: each })),
    );
    if (members.some(({ member }) => !isKnown(member))) {
      return { kind: 'open' };
    }
    const witnesses = new Map<number, FunctionCall[]>();
    for (const { to, member } of members) {
      for (const [position, call] of this.#callsThrough(to, member, trait)) {
        witnesses.set(position, [...(witnesses.get(position) ?? []), call]);
      }
    }
    return { kind: 'known', witnesses };
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

  /** The witnesses `member` gives `to`'s constraints of `trait`, by required function. */
  #callsThrough(
    to: AnyType,
    member: Type,
    trait: TraitDeclaration,
  ): readonly (readonly [number, FunctionCall])[] {
    return [...to.constraints.entries()].flatMap(([index, constraint]) =>
      constraint.trait === trait
        ? [...this.#checker.traitObjects.memberWitnesses(to, index, member).entries()].flatMap(
            ([position, call]) => (call.kind === 'function' ? [[position, call] as const] : []),
          )
        : [],
    );
  }
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

/** The types of the values a value of `type` may be, a union's each of its members'. */
function membersOf(type: Type): readonly Type[] {
  return type.kind === 'union' ? type.members.flatMap(membersOf) : [type];
}

/** The values `flow` puts into an `any`. */
function conversionsIn(flow: FlowFunction): readonly Conversion[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation): readonly Conversion[] => {
      if (operation.op === 'make' && operation.made.kind === 'closure') {
        return conversionsIn(operation.made.function);
      }
      if (operation.op !== 'copy' || operation.fit?.conversion.kind !== 'any') {
        return [];
      }
      const { to } = operation.fit.conversion;
      const from = flow.values[operation.from]?.type;
      return from === undefined ? [] : membersOf(from).map((member) => ({ to, member }));
    }),
  );
}

function sameDispatched(first: Dispatched, second: Dispatched): boolean {
  return first.kind === 'open' || second.kind === 'open'
    ? first.kind === second.kind
    : sameWitnesses(first.witnesses, second.witnesses);
}

function sameWitnesses(
  first: ReadonlyMap<number, readonly FunctionCall[]>,
  second: ReadonlyMap<number, readonly FunctionCall[]>,
): boolean {
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
