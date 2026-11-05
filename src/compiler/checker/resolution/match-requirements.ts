/**
 * The type `match`es an instantiation reaches, every one of which must reduce (§3.5, §3.17): no
 * case matching is a compile error where the alias is used, and a generic declaration's uses are
 * used where an instantiation gives its parameters their arguments.
 *
 * - A declaration's requirements are the types it holds that a type `match` use with arguments
 *   not known yet stands in: its fields, variants and associated types, an alias's body, and a
 *   function's written types, signature and body alike, with the type arguments its calls give and
 *   their callees' requirements, read through those arguments. A function reached again while its
 *   requirements are found adds none: the cycle's own uses are among the others'.
 * - An instantiation substitutes them, and any use whose arguments are then all known reduces:
 *   one matching no case, the error type carrying it, is reported where the instantiation is
 *   written. A nominal type reached
 *   on the way brings its declaration's requirements, through its own arguments, and a recursive
 *   use its shape, each once.
 * - A std function writes no type `match` use, and what its type arguments bring is the caller's
 *   to check, so its code is never checked for one.
 * - A use no case matches, written as such, is reported where it is written, by its own
 *   instantiation's check, so a declaration's requirements keep only the uses its own parameters
 *   stand in, but for an alias's body, which each use of the alias reduces.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameItems } from '../../../structures/equality.ts';
import {
  type DeclaredStruct,
  type EnumDeclaration,
  type FunctionDeclaration,
  type TypeAliasDeclaration,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { nodesUnder } from '../../syntax/tree.ts';
import { isWrittenType } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote, Instantiable } from '../context.ts';
import { functionCallsWithin } from '../resolved-call.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import type { Type, TypeMatchUse } from '../types/type.ts';
import { typeKeys } from '../types/type-keys.ts';
import { aliasInstance } from '../types/type-match.ts';
import { isKnown, sameTypeSpelled, typeChildren } from '../types/type-parts.ts';

export class MatchRequirements {
  readonly #checker: CheckerContext;
  readonly #requirements: EntryTable<CheckerNote, Instantiable, readonly Type[]>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#requirements = checker.entries.table({
      name: 'type match requirements',
      compute: (declaration) => this.#found(declaration),
      equal: sameItems(sameTypeSpelled),
      cyclic: { standIn: () => [] },
    });
  }

  /**
   * The first use of a type `match` no case matches that `declaration`, instantiated by
   * `typeArguments`, reaches (the banner); undefined when every one reduces.
   */
  unmatched(declaration: Instantiable, typeArguments: Substitution): TypeMatchUse | undefined {
    if (!isGenericDeclaration(declaration) && declaration.kind !== 'TypeAliasDeclaration') {
      return undefined;
    }
    const seen = new Set<string>();
    const pending = this.#instantiated(declaration, typeArguments);
    for (let type = pending.pop(); type !== undefined; type = pending.pop()) {
      if (type.kind === 'error' && type.unmatched !== undefined) {
        return type.unmatched;
      }
      const key = typeKeys.typeKey(type);
      if (type.kind !== 'error' && !seen.has(key)) {
        seen.add(key);
        pending.push(...this.#reached(type));
      }
    }
    return undefined;
  }

  /** What `type` leads on to: its parts, a recursive use's shape, a nominal's requirements. */
  #reached(type: Type): readonly Type[] {
    const parts = typeChildren(type);
    if (type.kind === 'recursive') {
      return [this.#checker.typeRules.recursiveShape(type), ...parts];
    }
    return type.kind === 'nominal' && type.arguments.length > 0
      ? [...this.#through(type.entity.declaration, type.arguments), ...parts]
      : parts;
  }

  /** `declaration`'s requirements, read through `typeArguments`, given for its parameters. */
  #through(declaration: Instantiable, typeArguments: readonly Type[]): Type[] {
    return this.#instantiated(
      declaration,
      substitutionFor(declaration.typeParameters, typeArguments),
    );
  }

  /** `declaration`'s requirements, with `substitution` applied. */
  #instantiated(declaration: Instantiable, substitution: Substitution): Type[] {
    const rules = this.#checker.typeRules;
    return this.#requirements
      .get(declaration)
      .map((required) => substitute(required, substitution, rules));
  }

  #found(declaration: Instantiable): readonly Type[] {
    if (declaration.kind === 'TypeAliasDeclaration') {
      return [this.#instance(declaration)];
    }
    const held = this.#held(declaration);
    return held.filter((type) => !isKnown(type) && this.#standsIn(type));
  }

  /** The type `alias` stands for, its own parameters open: a type `match` use left unreduced. */
  #instance(alias: TypeAliasDeclaration): Type {
    const checker = this.#checker;
    return aliasInstance(alias, checker.aliasedType(alias), new Map(), checker.typeRules);
  }

  /** The types `declaration` holds (the banner). */
  #held(declaration: Exclude<Instantiable, TypeAliasDeclaration>): readonly Type[] {
    const checker = this.#checker;
    switch (declaration.kind) {
      case 'FunctionDeclaration':
        return this.#functionTypes(declaration);
      case 'EnumDeclaration':
        return [
          ...checker
            .declaredVariantsOf(declaration)
            .flatMap(({ fields }) => fields.map((field) => field.type)),
          ...associated(checker, declaration),
        ];
      case 'ExternStructDeclaration':
        return [];
      default:
        return [
          ...checker.declaredFieldsOf(declaration).map((field) => field.type),
          ...associated(checker, declaration),
        ];
    }
  }

  /**
   * A function's types: those written in it, once its signature and code are checked, and those
   * the calls its code makes reach, read through each call's type arguments.
   */
  #functionTypes(declaration: FunctionDeclaration): readonly Type[] {
    const checker = this.#checker;
    if (checker.isStd(checker.moduleOf(declaration))) {
      return [];
    }
    const bodies = [checker.bodyOf(declaration), checker.defaultsOf(declaration)];
    checker.parametersOf(declaration);
    checker.resultOf(declaration);
    const tree = checker.inputs.treeOf(checker.moduleOf(declaration));
    const written = nodesUnder(tree, declaration).flatMap((node) => {
      const type =
        isWrittenType(node) && node.kind !== 'RestType' ? checker.resolvedTypeOf(node) : undefined;
      return type === undefined ? [] : [type];
    });
    const called = bodies
      .flatMap((body) => body?.madeCalls() ?? [])
      .flatMap(({ call }) => functionCallsWithin(call))
      .flatMap((call) =>
        call.function.typeParameters.length === 0
          ? []
          : [...call.typeArguments, ...this.#through(call.function, call.typeArguments)],
      );
    return [...written, ...called];
  }

  /** Whether a type `match` use stands in `type`, or a nominal type whose declaration has some. */
  #standsIn(type: Type): boolean {
    if (type.kind === 'match') {
      return true;
    }
    if (type.kind === 'nominal' && this.#requirements.get(type.entity.declaration).length > 0) {
      return true;
    }
    return typeChildren(type).some((child) => this.#standsIn(child));
  }
}

/** The types a struct's or enum's associated types stand for, its parameters open (§3.1). */
function associated(
  checker: CheckerContext,
  declaration: DeclaredStruct | EnumDeclaration,
): readonly Type[] {
  return declaration.associatedTypes.map((each) =>
    aliasInstance(each, checker.aliasedType(each), new Map(), checker.typeRules),
  );
}

/** Whether `declaration` has type parameters, which an instantiation gives arguments. */
function isGenericDeclaration(declaration: Instantiable): boolean {
  return typeParametersOf(declaration.typeParameters).length > 0;
}
