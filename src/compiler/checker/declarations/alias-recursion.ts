/**
 * Which aliases refer to themselves (§3.17), read from what their bodies name before any type is
 * resolved: resolving an alias's body needs to know first whether a use of it inside stands for the
 * alias (a recursive use) or would resolve the body again (a cycle, reported where aliases resolve).
 *
 * - A reference to an alias is guarded where it stands inside a type built from others: a type
 *   argument, a field of a shape, a tuple element, a function type's parameter or result. It is
 *   unguarded as the whole body, a union's member, an optional's inner type or in parentheses, and
 *   where what it names must be known first (`A.Data`, `A[K]`, `keyof A`): unfolding there would
 *   never end.
 * - An alias is recursive when a chain of references from its body reaches it again, and every
 *   such chain passes a guarded reference. One reached again through unguarded references only
 *   names no type: its resolution is a cycle (5106).
 * - Regular: each reference to an alias of its cycle passes the referring alias's own type
 *   parameters, in order. Any other would need endlessly many types, or types the alias was never
 *   written for, so it is reported (5128) and the alias stands for the error type.
 * - Only an alias declared at the top level whose body is a type takes part: an associated type,
 *   and an alias whose body is a type `match`, keep their own rules.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import type { AliasBody, TypeAliasDeclaration } from '../../syntax/declarations.ts';
import { type NamedType, type TypeNode, unparenthesizedType } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isMatchAlias } from '../types/computed-types.ts';

/** A reference in an alias's body to an alias that may take part in recursion. */
interface AliasReference {
  readonly node: NamedType;
  readonly target: TypeAliasDeclaration;
  readonly guarded: boolean;
}

/**
 * What an alias's body makes of it: nothing recursive, a recursive alias, one reaching itself
 * unguarded (a cycle), or a recursive one that isn't regular.
 */
export type AliasRecursion = 'none' | 'recursive' | 'cycle' | 'irregular';

export class AliasRecursions {
  readonly #checker: CheckerContext;
  readonly #moduleOf: (alias: TypeAliasDeclaration) => ModuleId;
  readonly #references: EntryTable<CheckerNote, TypeAliasDeclaration, readonly AliasReference[]>;
  readonly #recursions: EntryTable<CheckerNote, TypeAliasDeclaration, AliasRecursion>;

  constructor(checker: CheckerContext, moduleOf: (alias: TypeAliasDeclaration) => ModuleId) {
    this.#checker = checker;
    this.#moduleOf = moduleOf;
    this.#references = checker.entries.table({
      name: 'alias references',
      compute: (alias) => this.#referencesOf(alias),
    });
    this.#recursions = checker.entries.table({
      name: 'alias recursion',
      compute: (alias) => this.#recursionOf(alias),
    });
  }

  /**
   * Whether `alias`'s body is a union as written, through parentheses and aliases naming one: what
   * a union normalizing a use of it among its members asks (types/unions.ts), which must not
   * resolve the body, since the body may be what is being resolved.
   */
  isUnionBody(alias: TypeAliasDeclaration): boolean {
    const seen = new Set<TypeAliasDeclaration>();
    for (let current: TypeAliasDeclaration | undefined = alias; current !== undefined; ) {
      seen.add(current);
      const written = current.type;
      const body: AliasBody = written.kind === 'TypeMatch' ? written : unparenthesizedType(written);
      if (body.kind === 'UnionType' || body.kind === 'OptionalType') {
        return true;
      }
      const next: TypeAliasDeclaration | undefined = this.#aliasNamedBy(current, body);
      current = next === undefined || seen.has(next) ? undefined : next;
    }
    return false;
  }

  /** The alias `body`, written in `alias`, names as a whole; undefined for any other body. */
  #aliasNamedBy(alias: TypeAliasDeclaration, body: AliasBody): TypeAliasDeclaration | undefined {
    if (body.kind !== 'NamedType' || body.path.length !== 1) {
      return undefined;
    }
    const [name] = body.path;
    const entity =
      name === undefined ? undefined : this.#checker.bindings.entityOf(this.#moduleOf(alias), name);
    return entity?.kind === 'type' && entity.declaration.kind === 'TypeAliasDeclaration'
      ? entity.declaration
      : undefined;
  }

  /** What `alias`'s body makes of it (the banner); an irregular one is reported once. */
  recursionOf(alias: TypeAliasDeclaration): AliasRecursion {
    return isMatchAlias(alias) ? 'none' : this.#recursions.get(alias);
  }

  #recursionOf(alias: TypeAliasDeclaration): AliasRecursion {
    let recursive = false;
    // Each alias is reached at most twice: through unguarded references only, and through a guard.
    const seen = { true: new Set<TypeAliasDeclaration>(), false: new Set<TypeAliasDeclaration>() };
    const pending = this.#references.get(alias).map(({ target, guarded }) => ({
      target,
      unguarded: !guarded,
    }));
    for (let step = pending.pop(); step !== undefined; step = pending.pop()) {
      const reached = seen[`${step.unguarded}`];
      if (step.target === alias && step.unguarded) {
        return 'cycle';
      }
      if (step.target === alias) {
        recursive = true;
      } else if (!reached.has(step.target)) {
        reached.add(step.target);
        for (const { target, guarded } of this.#references.get(step.target)) {
          pending.push({ target, unguarded: step.unguarded && !guarded });
        }
      }
    }
    if (!recursive) {
      return 'none';
    }
    const irregular = this.#irregularReference(alias);
    if (irregular === undefined) {
      return 'recursive';
    }
    const named = irregular.path.at(-1)?.text ?? alias.name.text;
    this.#checker.report(
      this.#moduleOf(alias),
      checkerDiagnostics.irregularAlias(alias.name.span, alias.name.text, named),
    );
    return 'irregular';
  }

  /**
   * The first reference in `alias`'s body to an alias of its cycle that doesn't pass `alias`'s own
   * type parameters, in order; undefined when every one does.
   */
  #irregularReference(alias: TypeAliasDeclaration): NamedType | undefined {
    const module = this.#moduleOf(alias);
    const { bindings } = this.#checker;
    const passesOwn = ({ typeArguments }: NamedType): boolean =>
      typeArguments.length === alias.typeParameters.length &&
      typeArguments.every((argument, index) => {
        const [name, ...more] = argument.kind === 'NamedType' ? argument.path : [];
        const entity = name === undefined ? undefined : bindings.entityOf(module, name);
        return (
          more.length === 0 &&
          argument.kind === 'NamedType' &&
          argument.typeArguments.length === 0 &&
          entity?.kind === 'type' &&
          entity.declaration === alias.typeParameters[index]
        );
      });
    return this.#references
      .get(alias)
      .find(({ node, target }) => this.#reaches(target, alias) && !passesOwn(node))?.node;
  }

  /** Whether a chain of references from `from`'s body reaches `to`, or `from` is `to`. */
  #reaches(from: TypeAliasDeclaration, to: TypeAliasDeclaration): boolean {
    const seen = new Set<TypeAliasDeclaration>();
    const pending = [from];
    for (let alias = pending.pop(); alias !== undefined; alias = pending.pop()) {
      if (alias === to) {
        return true;
      }
      if (!seen.has(alias)) {
        seen.add(alias);
        pending.push(...this.#references.get(alias).map(({ target }) => target));
      }
    }
    return false;
  }

  /** The references to aliases taking part in recursion that `alias`'s body makes. */
  #referencesOf(alias: TypeAliasDeclaration): readonly AliasReference[] {
    const body = alias.type;
    if (body.kind === 'TypeMatch') {
      return [];
    }
    const module = this.#moduleOf(alias);
    const references: AliasReference[] = [];
    const visit = (node: TypeNode, guarded: boolean): void => {
      for (const { child, guards } of typeChildrenOf(node)) {
        visit(child, guarded || guards);
      }
      if (node.kind !== 'NamedType') {
        return;
      }
      const [name, ...members] = node.path;
      const entity = name === undefined ? undefined : this.#checker.bindings.entityOf(module, name);
      if (
        entity?.kind === 'type' &&
        entity.declaration.kind === 'TypeAliasDeclaration' &&
        !isMatchAlias(entity.declaration)
      ) {
        // `A.Data` needs `A` known first, so the reference is never guarded.
        references.push({
          node,
          target: entity.declaration,
          guarded: guarded && members.length === 0,
        });
      }
    };
    visit(body, false);
    return references;
  }
}

/**
 * The type nodes `node` is built from, one level down, each with whether it stands guarded there
 * (the banner).
 */
function typeChildrenOf(
  node: TypeNode,
): readonly { readonly child: TypeNode; readonly guards: boolean }[] {
  const guarded = (children: readonly TypeNode[]) =>
    children.map((child) => ({ child, guards: true }));
  const unguarded = (children: readonly TypeNode[]) =>
    children.map((child) => ({ child, guards: false }));
  switch (node.kind) {
    case 'NamedType':
      return guarded(node.typeArguments);
    case 'OptionalType':
    case 'ParenthesizedType':
      return unguarded([node.inner]);
    case 'ReferenceType':
      return unguarded([node.referent]);
    case 'UnionType':
      return unguarded(node.members);
    case 'TupleType':
      return guarded(node.elements);
    case 'FunctionType':
      return guarded([
        ...node.parameters.map((parameter) =>
          parameter.kind === 'RestType' ? parameter.type : parameter,
        ),
        ...(node.returnType === undefined ? [] : [node.returnType]),
      ]);
    case 'StructType':
      return guarded(
        node.fields.flatMap((field) => (field.kind === 'Invalid' ? [] : [field.type])),
      );
    case 'MemberType':
    case 'KeyofType':
      return unguarded([node.owner]);
    case 'IndexedType':
      return unguarded([node.owner, node.key]);
    case 'AnyType':
      return guarded(node.traits);
    case 'LiteralType':
    case 'InferType':
    case 'Missing':
    case 'Invalid':
      return [];
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}
