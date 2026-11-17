/**
 * Shared instances (§3.5): an instance is keyed, and lowered, with each type argument its
 * declaration's code uses only opaquely (checker `opaqueParametersOf`) replaced by the prelude's
 * stand-in for that argument's lifetime class, so instantiations a backend runs alike are one entry
 * (Go's GC-shape stenciling, with the lifetime class as the shape).
 *
 * - The class is the Definition's own (`lifetimeOf`), and a stand-in's entry has it, so code typed
 *   by a stand-in holds and lets go of a value as code typed by its argument would.
 * - An argument whose class can't be read yet, its entry still being laid out (a recursive type's
 *   own `dispose`), stays as it is: that instance is merely not shared.
 * - Witnesses are left as they are: an opaque parameter is constrained by nothing.
 * - A shared instance's name spells a stand-in as the parameter it stands for (instances.ts).
 */

import type { Lifetime } from '../../../definition/tables/types.ts';
import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../foundation/language/well-known/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { typeParametersOf } from '../../syntax/declarations/index.ts';
import type { TypeTable } from './type-table.ts';

/** The prelude's stand-in for each lifetime class. */
const standIns = {
  plain: wellKnown.plainStandIn,
  heap: wellKnown.heapStandIn,
  counted: wellKnown.countedStandIn,
} as const satisfies Record<Lifetime, WellKnownDeclaration>;

/** Whether `type` is a stand-in, which a shared instance's name spells as its parameter. */
export function isStandIn(checker: Pick<Checker, 'wellKnownEntity'>, type: Type): boolean {
  return (
    type.kind === 'nominal' &&
    Object.values(standIns).some((standIn) => checker.wellKnownEntity(standIn) === type.entity)
  );
}

export class Stencils {
  readonly #checker: Checker;
  readonly #types: TypeTable;
  readonly #standIns = new Map<Lifetime, Type>();

  constructor(checker: Checker, types: TypeTable) {
    this.#checker = checker;
    this.#types = types;
  }

  /** `instance` as its entry is keyed and lowered: each opaque argument its stand-in. */
  shared(instance: FunctionInstance): FunctionInstance {
    const opaque = this.#checker.opaqueParametersOf(instance.declaration);
    if (opaque.size === 0) {
      return instance;
    }
    const parameters = typeParametersOf(instance.declaration.typeParameters);
    const typeArguments = instance.typeArguments.map((argument, position) => {
      const parameter = parameters[position];
      const lifetime =
        parameter !== undefined && opaque.has(parameter)
          ? this.#types.lifetimeOf(argument)
          : undefined;
      return lifetime === undefined ? argument : this.#standIn(lifetime);
    });
    return { ...instance, typeArguments };
  }

  /** The stand-in of `lifetime`, which its own entry must keep as one. */
  #standIn(lifetime: Lifetime): Type {
    return memo(this.#standIns, lifetime, () => {
      const standIn =
        this.#checker.wellKnownType(standIns[lifetime]) ??
        unreachable('A program sharing instances has a prelude.');
      const kept = this.#types.lifetimeOf(standIn);
      if (kept !== lifetime) {
        unreachable(`The ${lifetime} stand-in is kept as ${String(kept)}.`);
      }
      return standIn;
    });
  }
}
