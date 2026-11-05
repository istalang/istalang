/**
 * Which aliases refer to themselves (§3.17), read from what their bodies name before any type is
 * resolved: resolving an alias's body needs to know first whether a use of it inside stands for the
 * alias (a placeholder while its group closes) or would resolve the body again (a cycle, reported where aliases resolve).
 *
 * - A reference to an alias is guarded where it stands inside a type built from others: a type
 *   argument, a field of a shape, a tuple element, a function type's parameter or result. It is
 *   unguarded as the whole body, a union's member, an optional's inner type or in parentheses.
 * - It blocks where what it names must be known first, guarded or not: `A.Data`, `A[K]`, `keyof A`,
 *   and inside an `any` type's constraints, which resolve as conformance does. Closing a group
 *   resolves its bodies with each use a placeholder (recursive-bodies.ts), which nothing can be
 *   asked of.
 * - An alias is recursive when a chain of references from its body reaches it again, and every
 *   such chain passes a guarded reference and no blocking one. One reached again through unguarded
 *   or blocking references names no type: its resolution is a cycle (5106).
 * - Its group is the aliases recursive with it, each reaching the other: they close together.
 * - Regular: each reference to an alias of its cycle passes the referring alias's own type
 *   parameters, in order. Any other would need endlessly many types, or types the alias was never
 *   written for, so it is reported (5128) and the alias stands for the error type.
 * - Only an alias declared at the top level whose body is a type takes part: an associated type,
 *   and an alias whose body is a type `match`, keep their own rules.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { NamedType, TypeNode } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isMatchAlias } from '../types/computed-types.ts';

/** A reference in an alias's body to an alias that may take part in recursion. */
interface AliasReference {
  readonly node: NamedType;
  readonly target: TypeAliasDeclaration;
  readonly guarded: boolean;
  readonly blocking: boolean;
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
   * The aliases closing together with the recursive `alias` (the banner): `alias` first, then each
   * other recursive alias it reaches that reaches it, in the order its references reach them.
   */
  groupOf(alias: TypeAliasDeclaration): readonly TypeAliasDeclaration[] {
    const reached: TypeAliasDeclaration[] = [];
    const seen = new Set<TypeAliasDeclaration>([alias]);
    const pending = [...this.#references.get(alias)].reverse().map(({ target }) => target);
    for (let each = pending.pop(); each !== undefined; each = pending.pop()) {
      if (!seen.has(each)) {
        seen.add(each);
        reached.push(each);
        pending.push(...[...this.#references.get(each)].reverse().map(({ target }) => target));
      }
    }
    const others = reached.filter(
      (each) => this.recursionOf(each) === 'recursive' && this.#reaches(each, alias),
    );
    return [alias, ...others];
  }

  /** Whether `node` writes a reference to one of `aliases`, at any depth, in `module`. */
  writesReference(
    module: ModuleId,
    node: TypeNode,
    aliases: ReadonlySet<TypeAliasDeclaration>,
  ): boolean {
    if (node.kind === 'NamedType') {
      const [name] = node.path;
      const entity = name === undefined ? undefined : this.#checker.bindings.entityOf(module, name);
      if (
        entity?.kind === 'type' &&
        entity.declaration.kind === 'TypeAliasDeclaration' &&
        aliases.has(entity.declaration)
      ) {
        return true;
      }
    }
    return typeChildrenOf(node).some(({ child }) => this.writesReference(module, child, aliases));
  }

  /** What `alias`'s body makes of it (the banner); an irregular one is reported once. */
  recursionOf(alias: TypeAliasDeclaration): AliasRecursion {
    return isMatchAlias(alias) ? 'none' : this.#recursions.get(alias);
  }

  #recursionOf(alias: TypeAliasDeclaration): AliasRecursion {
    const reached = this.#reachedAgain(alias);
    if (reached !== 'guarded') {
      return reached;
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
   * How chains of references from `alias`'s body reach it again (the banner): never, only through
   * a guard and no blocking reference, or otherwise, a cycle.
   */
  #reachedAgain(alias: TypeAliasDeclaration): 'none' | 'guarded' | 'cycle' {
    let reached: 'none' | 'guarded' = 'none';
    // Each alias is reached at most once per way of reaching it: guarded or not, blocked or not.
    const seen = new Set<string>();
    const pending = this.#references.get(alias).map(({ target, guarded, blocking }) => ({
      target,
      guarded,
      blocked: blocking,
    }));
    for (let step = pending.pop(); step !== undefined; step = pending.pop()) {
      const way = `${this.#checker.typeKeys.identityOf(step.target)}/${step.guarded}/${step.blocked}`;
      if (step.target === alias && (!step.guarded || step.blocked)) {
        return 'cycle';
      }
      if (step.target === alias) {
        reached = 'guarded';
      } else if (!seen.has(way)) {
        seen.add(way);
        for (const { target, guarded, blocking } of this.#references.get(step.target)) {
          pending.push({
            target,
            guarded: step.guarded || guarded,
            blocked: step.blocked || blocking,
          });
        }
      }
    }
    return reached;
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
    const visit = (node: TypeNode, guarded: boolean, blocked: boolean): void => {
      for (const { child, guards, blocks } of typeChildrenOf(node)) {
        visit(child, guarded || guards, blocked || blocks);
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
        // `A.Data` needs `A` known first.
        references.push({
          node,
          target: entity.declaration,
          guarded,
          blocking: blocked || members.length > 0,
        });
      }
    };
    visit(body, false, false);
    return references;
  }
}

/**
 * The type nodes `node` is built from, one level down, each with whether it stands guarded there,
 * and whether what it names must be known first (the banner).
 */
function typeChildrenOf(node: TypeNode): readonly {
  readonly child: TypeNode;
  readonly guards: boolean;
  readonly blocks: boolean;
}[] {
  const guarded = (children: readonly TypeNode[]) =>
    children.map((child) => ({ child, guards: true, blocks: false }));
  const unguarded = (children: readonly TypeNode[]) =>
    children.map((child) => ({ child, guards: false, blocks: false }));
  const blocking = (children: readonly TypeNode[]) =>
    children.map((child) => ({ child, guards: false, blocks: true }));
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
      return blocking([node.owner]);
    case 'IndexedType':
      return blocking([node.owner, node.key]);
    case 'AnyType':
      return blocking(node.traits);
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
