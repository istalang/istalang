/**
 * Which aliases refer to themselves (§3.17), read from what their bodies name before any type is
 * resolved: resolving an alias's body needs to know first whether a use of it inside stands for the
 * alias (a placeholder while its group closes) or would resolve the body again (a cycle, reported where aliases resolve).
 *
 * - A reference to an alias is guarded where it stands inside a type built from others: a nominal
 *   type's argument, a trait's argument in an `any` type, a field of a shape, a tuple element, a
 *   function type's parameter or result. It is unguarded as the whole body, a union's member, an
 *   optional's inner type or in parentheses.
 * - An alias's argument stands where the alias's body puts its parameter (`parameterStandings`):
 *   guarded only where every use of it there is, so `Id<A>` for `type Id<T> = T` stands as `A`
 *   does. A type `match` alias's argument the match inspects (a case pattern other than `_` or a
 *   bare `infer`) must be known first; else it stands as every case's type uses it, or what each
 *   case infers from it whole.
 * - It blocks where what it names must be known first, guarded or not: `A.Data`, `A[K]`, `keyof A`.
 *   Closing a group resolves its bodies with each use a placeholder (recursive-bodies.ts), which
 *   nothing can be asked of.
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
import {
  type TypeAliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { inferTypesIn } from '../../syntax/type-matches.ts';
import type { NamedType, TypeMatch, TypeNode } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isMatchAlias } from '../types/computed-types.ts';
import { namedPathOf } from '../types/named-paths.ts';

/** A reference in an alias's body to an alias that may take part in recursion. */
interface AliasReference {
  readonly node: NamedType;
  readonly target: TypeAliasDeclaration;
  readonly guarded: boolean;
  readonly blocking: boolean;
}

/** How a type stands where it is written: guarded or not, and whether it must be known first. */
interface Standing {
  readonly guards: boolean;
  readonly blocks: boolean;
}

const guardedStanding: Standing = { guards: true, blocks: false };
const unguardedStanding: Standing = { guards: false, blocks: false };

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
  readonly #parameterStandings: EntryTable<CheckerNote, TypeAliasDeclaration, readonly Standing[]>;

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
    this.#parameterStandings = checker.entries.table({
      name: 'alias parameter standings',
      compute: (alias) => this.#standingsOf(alias),
      // A parameter reached again while its standing is found stands unguarded.
      cyclic: {
        standIn: (alias) => typeParametersOf(alias.typeParameters).map(() => unguardedStanding),
      },
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
      const { entity } = namedPathOf(this.#checker.bindings, module, node);
      if (
        entity?.kind === 'type' &&
        entity.declaration.kind === 'TypeAliasDeclaration' &&
        aliases.has(entity.declaration)
      ) {
        return true;
      }
    }
    return typeChildrenOf(node, () => []).some(({ child }) =>
      this.writesReference(module, child, aliases),
    );
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
        if (argument.kind !== 'NamedType') {
          return false;
        }
        const { entity, members } = namedPathOf(bindings, module, argument);
        return (
          members.length === 0 &&
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
    return this.#namedIn(module, body, unguardedStanding).flatMap(({ node, standing }) => {
      const { entity, members } = namedPathOf(this.#checker.bindings, module, node);
      return entity?.kind === 'type' &&
        entity.declaration.kind === 'TypeAliasDeclaration' &&
        !isMatchAlias(entity.declaration)
        ? [
            {
              node,
              target: entity.declaration,
              guarded: standing.guards,
              // `A.Data` needs `A` known first.
              blocking: standing.blocks || members.length > 0,
            },
          ]
        : [];
    });
  }

  /** Each named type `node` writes, at any depth, innermost first, with how it stands there. */
  #namedIn(
    module: ModuleId,
    node: TypeNode,
    standing: Standing,
  ): readonly { readonly node: NamedType; readonly standing: Standing }[] {
    const named: { readonly node: NamedType; readonly standing: Standing }[] = [];
    const visit = (each: TypeNode, at: Standing): void => {
      const children = typeChildrenOf(each, (argumentsOf) =>
        this.#argumentStandings(module, argumentsOf),
      );
      for (const { child, guards, blocks } of children) {
        visit(child, { guards: at.guards || guards, blocks: at.blocks || blocks });
      }
      if (each.kind === 'NamedType') {
        named.push({ node: each, standing: at });
      }
    };
    visit(node, standing);
    return named;
  }

  /**
   * How each type argument `node` writes stands (the banner): where the alias it names puts its
   * parameter; guarded for any other type, which builds a type from them.
   */
  #argumentStandings(module: ModuleId, node: NamedType): readonly Standing[] {
    const { entity, members } = namedPathOf(this.#checker.bindings, module, node);
    return members.length === 0 &&
      entity?.kind === 'type' &&
      entity.declaration.kind === 'TypeAliasDeclaration'
      ? this.#parameterStandings.get(entity.declaration)
      : [];
  }

  /** How each of `alias`'s parameters stands in its body (the banner), in order. */
  #standingsOf(alias: TypeAliasDeclaration): readonly Standing[] {
    const module = this.#moduleOf(alias);
    const body = alias.type;
    return typeParametersOf(alias.typeParameters).map((parameter) =>
      body.kind === 'TypeMatch'
        ? this.#matchStanding(module, body, parameter)
        : jointStanding(this.#usesOf(module, body, [parameter])),
    );
  }

  /**
   * How `parameter` stands in the type `match` `body`: known first where a case inspects the
   * subject holding it; else as every case's type uses it, or what the case infers from it whole.
   */
  #matchStanding(module: ModuleId, body: TypeMatch, parameter: TypeParameter): Standing {
    const inSubject = this.#usesOf(module, body.subject, [parameter]).length > 0;
    const cases = body.cases.flatMap((each) => (each.kind === 'TypeCase' ? [each] : []));
    const inspects = cases.some(
      ({ pattern }) => pattern.kind !== 'WildcardPattern' && pattern.kind !== 'InferType',
    );
    if (inSubject && inspects) {
      return { guards: false, blocks: true };
    }
    return jointStanding(
      cases.flatMap((each) =>
        this.#usesOf(module, each.type, [
          parameter,
          ...(inSubject ? inferTypesIn(each.pattern).map((infer) => infer.parameter) : []),
        ]),
      ),
    );
  }

  /** How each use of one of `parameters` in `node`, the whole of a type, stands there. */
  #usesOf(
    module: ModuleId,
    node: TypeNode,
    parameters: readonly TypeParameter[],
  ): readonly Standing[] {
    return this.#namedIn(module, node, unguardedStanding).flatMap(({ node: named, standing }) => {
      const { entity, members } = namedPathOf(this.#checker.bindings, module, named);
      return members.length === 0 &&
        entity?.kind === 'type' &&
        entity.declaration.kind === 'TypeParameter' &&
        parameters.includes(entity.declaration)
        ? [standing]
        : [];
    });
  }
}

/** How a parameter used where `uses` stand stands: guarded only where every use is. */
function jointStanding(uses: readonly Standing[]): Standing {
  return {
    guards: uses.every((use) => use.guards),
    blocks: uses.some((use) => use.blocks),
  };
}

/**
 * The type nodes `node` is built from, one level down, each with whether it stands guarded there,
 * and whether what it names must be known first (the banner).
 */
function typeChildrenOf(
  node: TypeNode,
  argumentStandings: (node: NamedType) => readonly Standing[],
): readonly {
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
    case 'NamedType': {
      const standings = argumentStandings(node);
      return node.typeArguments.map((child, index) => ({
        child,
        ...(standings[index] ?? guardedStanding),
      }));
    }
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
