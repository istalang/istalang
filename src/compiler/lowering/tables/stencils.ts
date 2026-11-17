/**
 * Shared instances (§3.5): an instance is keyed, and lowered, with each type argument its
 * declaration's code uses only opaquely (checker `opaqueParametersOf`) replaced by the stand-in for
 * that argument's representation (definition `representationOf`), so instantiations every backend
 * runs alike are one entry (Go's GC-shape stenciling, with the representation as the shape).
 *
 * - A primitive stands for its own representation, so an instance at a literal type is the one at
 *   its base; any other representation has the prelude's stand-in, whose own entry has it, checked.
 * - An argument whose representation can't be read yet, its entry still being laid out (a recursive
 *   type's own `dispose`), stays as it is: that instance is merely not shared.
 * - Witnesses are left as they are: an opaque parameter is constrained by nothing.
 * - A shared instance's name spells a prelude stand-in as the parameter it stands for
 *   (instances.ts).
 */

import { type Representation, sameRepresentation } from '../../../definition/tables/types.ts';
import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import { nominalsIn } from '../../checker/types/parts/type-parts.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { primitiveType } from '../../checker/types/type/primitives.ts';
import { typeParametersOf } from '../../syntax/declarations/index.ts';
import type { TypeTable } from './type-table/index.ts';

/** The prelude's stand-in of each representation a primitive isn't. */
const preludeStandIns = {
  tag: wellKnown.tagStandIn,
  handle: wellKnown.handleStandIn,
  heap: wellKnown.heapStandIn,
  counted: wellKnown.countedStandIn,
} as const satisfies Record<Exclude<Representation['kind'], 'primitive'>, WellKnownDeclaration>;

/**
 * Whether `type` holds a prelude stand-in at any depth: what a decision by a type's shape (a
 * union's order, a conversion, a codec) must never meet, since parametricity keeps every parameter
 * such a decision reads concrete; one that meets it is drift between the two, which must crash.
 */
export function holdsStandIn(checker: Pick<Checker, 'wellKnownEntity'>, type: Type): boolean {
  return nominalsIn(type).some((nominal) => isStandIn(checker, nominal));
}

/** Whether `type` is a prelude stand-in, which a shared instance's name spells as its parameter. */
export function isStandIn(checker: Pick<Checker, 'wellKnownEntity'>, type: Type): boolean {
  return (
    type.kind === 'nominal' &&
    Object.values(preludeStandIns).some(
      (standIn) => checker.wellKnownEntity(standIn) === type.entity,
    )
  );
}

export class Stencils {
  readonly #checker: Checker;
  readonly #types: TypeTable;

  constructor(checker: Checker, types: TypeTable) {
    this.#checker = checker;
    this.#types = types;
  }

  /** `instance` as its entry is keyed and lowered: each opaque argument its stand-in. */
  shared(instance: FunctionInstance): FunctionInstance {
    const opaque = this.#checker.opaqueParametersOf(instance.declaration);
    const parameters = typeParametersOf(instance.declaration.typeParameters);
    const typeArguments = instance.typeArguments.map((argument, position) => {
      const parameter = parameters[position];
      if (
        !(parameter !== undefined && opaque.has(parameter)) &&
        holdsStandIn(this.#checker, argument)
      ) {
        unreachable(
          `${instance.declaration.name.text} reads its type argument ${String(position)}, which a shared instance gave a stand-in.`,
        );
      }
      const representation =
        parameter !== undefined && opaque.has(parameter)
          ? this.#types.representationOf(argument)
          : undefined;
      return representation === undefined ? argument : this.#standIn(representation);
    });
    return { ...instance, typeArguments };
  }

  /** The stand-in of `representation`, which its own entry must have. */
  #standIn(representation: Representation): Type {
    const standIn =
      representation.kind === 'primitive'
        ? primitiveType(representation.name)
        : (this.#checker.wellKnownType(preludeStandIns[representation.kind]) ??
          unreachable('A program sharing instances has a prelude.'));
    const kept = this.#types.representationOf(standIn);
    if (kept === undefined || !sameRepresentation(kept, representation)) {
      unreachable(`The ${representation.kind} stand-in is represented otherwise.`);
    }
    return standIn;
  }
}
