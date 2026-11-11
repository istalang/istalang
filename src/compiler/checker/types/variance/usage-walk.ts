/**
 * One walk over a declaration's parts (§3.5), noting where each of its type parameters is met: at
 * the variance of each position, a function type's parameter flipping it, the future it gives
 * standing for its value and its mark and sendability making it invariant, a declaration's or an
 * `any` type's trait's type arguments composing it with that declaration's, and a computed type
 * making it invariant. variance.ts runs it to a fixpoint.
 */

import type { TraitDeclaration, TypeParameter } from '../../../syntax/declarations/index.ts';
import { typeChildren } from '../parts/type-children.ts';
import {
  type RecursiveGraph,
  type RecursiveType,
  unfoldRecursive,
} from '../type/computed-types.ts';
import type { AwaitedType } from '../type/function-types.ts';
import type { FunctionType, NominalDeclaration, Type, TypeParameterType } from '../type/index.ts';
import type { Variance } from './lattice.ts';
import { composed, flipped, joined, type Usage } from './lattice.ts';

/** One walk over a declaration's parts, noting where each of its parameters is met. */
export class UsageWalk {
  readonly usages: Usage[];
  readonly #parameters: readonly TypeParameter[];
  readonly #variancesOf: (declaration: NominalDeclaration | TraitDeclaration) => readonly Usage[];
  readonly #awaitedOf: (type: Type) => AwaitedType | undefined;
  /** Each node of a recursive type is walked once per position it is met at. */
  readonly #walked = new Map<RecursiveGraph, Set<string>>();

  constructor(
    parameters: readonly TypeParameter[],
    variancesOf: (declaration: NominalDeclaration | TraitDeclaration) => readonly Usage[],
    awaitedOf: (type: Type) => AwaitedType | undefined,
  ) {
    this.#parameters = parameters;
    this.#variancesOf = variancesOf;
    this.#awaitedOf = awaitedOf;
    this.usages = parameters.map(() => 'unused');
  }

  walk(type: Type, at: Variance): void {
    switch (type.kind) {
      case 'parameter':
        this.#meet(type.declaration, at);
        return;
      case 'nominal':
        this.#arguments(type.entity.declaration, type.arguments, at);
        return;
      case 'any':
        for (const { trait, arguments: given } of type.constraints) {
          this.#arguments(trait, given, at);
        }
        return;
      case 'function':
        this.#function(type, at);
        return;
      case 'recursive':
        this.#recursive(type, at);
        return;
      case 'anonymous':
      case 'tuple':
      case 'union':
        this.#each(typeChildren(type), at);
        return;
      default:
        // Computed types: no variance.
        this.#each(typeChildren(type), 'invariant');
    }
  }

  #meet(parameter: TypeParameterType['declaration'], at: Variance): void {
    const index = parameter.kind === 'TypeParameter' ? this.#parameters.indexOf(parameter) : -1;
    if (index >= 0) {
      this.usages[index] = joined(this.usages[index] ?? 'unused', at);
    }
  }

  /** The type arguments `given` to `declaration`, met where its variance puts each. */
  #arguments(
    declaration: NominalDeclaration | TraitDeclaration,
    given: readonly Type[],
    at: Variance,
  ): void {
    const inner = this.#variancesOf(declaration);
    given.forEach((argument, index) => {
      const position = composed(at, inner[index] ?? 'invariant');
      if (position !== 'unused') {
        this.walk(argument, position);
      }
    });
  }

  #function(type: FunctionType, at: Variance): void {
    // A mark and a sendability are compared by their own orders, never fitted as values are
    // (mark-orders.ts), so a type parameter met in either slot varies in neither.
    this.walk(type.mark, 'invariant');
    this.walk(type.send, 'invariant');
    for (const parameter of type.parameters) {
      this.walk(parameter.type, parameter.reference ? 'invariant' : flipped(at));
    }
    if (type.pack !== undefined) {
      this.walk(type.pack, flipped(at));
    }
    // A function giving a future fits where one giving a future of a wider value is expected, its
    // future awaited (§3.14), so it varies in what its future gives as in what it gives, and never
    // in the future's kind, which the kinds never leave (proposal 8, Rule 4).
    const awaited = this.#awaitedOf(type.result);
    if (awaited === undefined) {
      this.walk(type.result, at);
    } else {
      this.walk(awaited.value, at);
      this.walk(awaited.mode, 'invariant');
    }
  }

  #recursive(type: RecursiveType, at: Variance): void {
    const positions = this.#walked.get(type.graph) ?? new Set<string>();
    this.#walked.set(type.graph, positions);
    const position = `${type.node}:${at}`;
    if (!positions.has(position)) {
      positions.add(position);
      this.walk(unfoldRecursive(type), at);
    }
  }

  #each(types: readonly Type[], at: Variance): void {
    for (const type of types) {
      this.walk(type, at);
    }
  }
}
