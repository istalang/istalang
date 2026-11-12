/**
 * What a call through an `any` value may run (design.md §5.4): the witnesses of the required
 * function among the types the program puts into an `any` of its trait, so the call is checked
 * where it is made, with what it is given, as a call of each would be.
 *
 * - **Per module, an entry** lists the values its bodies put into an `any`, by the `any` type and
 *   the value's type; an edit keeping those leaves it equal, so nothing reading it runs again.
 * - **Per trait, an entry** gathers, over every module, each required function's witnesses.
 *   Values of an `any` are only ever made by putting a value into it, so nothing else can run.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { FunctionCall, RequirementCall } from '../../surface/resolved-call.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { AnyType, Type } from '../../types/type/index.ts';
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
      equal: sameWitnesses,
    });
  }

  /** What `call` may run, where it is a call through an `any` value; else undefined. */
  dispatched(call: RequirementCall): readonly FunctionCall[] | undefined {
    const { requirement } = call;
    if (requirement.kind !== 'constraint' || requirement.on.kind !== 'any') {
      return undefined;
    }
    const constraint = requirement.on.constraints[requirement.constraint];
    return constraint === undefined
      ? undefined
      : (this.#witnesses.get(constraint.trait).get(requirement.member) ?? []);
  }

  #witnessesOf(trait: TraitDeclaration): Witnesses {
    const witnesses = new Map<number, FunctionCall[]>();
    const conversions = this.#checker.inputs
      .modules()
      .flatMap((module) => this.#conversions.get(module));
    for (const { to, member } of conversions) {
      for (const [position, call] of this.#callsThrough(to, member, trait)) {
        witnesses.set(position, [...(witnesses.get(position) ?? []), call]);
      }
    }
    return witnesses;
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
      const member = flow.values[operation.from]?.type;
      return member === undefined ? [] : [{ to: operation.fit.conversion.to, member }];
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
