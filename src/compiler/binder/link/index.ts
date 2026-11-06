/**
 * Linking: what every module's bindings leave open, resolved across the program (§3.11, §3.13).
 *
 * - An import names an export of the module its path loaded. A private name (`_x`) is reported as
 *   private, anything else missing as not exported.
 * - Only a test module may import `testing`, or another test module (§10).
 * - The prelude is every module's outer scope. Reusing one of its names at the top level is an
 *   error, except for a function, declared or imported, which joins the prelude's overloads of its
 *   name, as a module's `fn add(left: Time, right: Duration)` joins the prelude's `add(Int, Float)`
 *   (§3.9).
 * - A name still free after the prelude may be a variant that only the expected type identifies,
 *   if some enum of the program has a variant by that name. A called name may name functions only
 *   argument-dependent lookup finds (§3.13), so it denotes a function set with no overloads of its
 *   own, and the checker reports it when lookup finds none. Anything else is reported with the
 *   reason its scopes noted, or as undeclared.
 * - A qualified name walks through modules and enums part by part, an alias of an enum as the enum
 *   (qualifiers.ts), and stops at the first part that is neither: what follows is a member, the
 *   checker's to resolve. In an expression, a part
 *   an enum lacks may be a static function (`Color.default()`), so only a pattern or type reports
 *   it as a missing variant.
 *
 * Linking makes no entities but the empty function sets of names left to argument-dependent
 * lookup, and those once per module's items: it maps names to the ones binding made, so their
 * identities hold across snapshots. What depends on the whole program (a function set joined with
 * the prelude's, a bare name's candidate variants) is answered per query and memoized on the
 * Program.
 *
 * Imported names are never re-exported, so resolving one module's imports needs only the others'
 * own declarations, and linking needs no fixpoint even when imports form cycles. Every module's
 * imports and top level are linked before any module's free names, since a free name may resolve
 * to what an import brought in; the Linker runs both passes as it is made, in that order.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { addToGroup } from '../../../structures/groups.ts';
import { memo, SequenceMemo } from '../../../structures/memo.ts';
import { isTestModule, type ModuleId, type Program, programModule } from '../../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  Module,
} from '../../syntax/declarations/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import { diagnosticIn } from '../../syntax/positions.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import {
  type Bindings,
  type Entity,
  type FunctionsEntity,
  type NamespaceEntity,
  namesType,
  type Qualifier,
  type VariantEntity,
} from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import type { FreeName, QualifiedPath } from '../module/local-binder.ts';
import { noOwnCall } from '../module/own-calls.ts';
import { undeclaredName } from '../naming.ts';
import { type ModuleLinks, resolvedImport } from './module-links.ts';
import { type AliasLookup, qualifierOf } from './qualifiers.ts';
import { checkTestImports, meetPrelude } from './top-level-rules.ts';

/**
 * Per module, the empty function set each called name no scope defines denotes. It is kept while
 * the module's items are, as entities are kept with their nodes (entities.ts), so an edit inside a
 * body keeps it, and everything the checker took over about it.
 */
const unseenFunctions = new SequenceMemo<Module['items'][number], Map<string, FunctionsEntity>>();

/** Every module's own bindings (`locals`), linked across `program`. */
export function link(program: Program, locals: ReadonlyMap<ModuleId, ModuleBindings>): Bindings {
  const linker = new Linker(program, locals);
  return {
    entityOf: (module, name) => linker.entityOf(module, name),
    exportsOf: (module) => linker.local(module)?.exports ?? new Map(),
    moduleOf: (entity) => linker.moduleOf(entity),
    isTopLevel: (entity) => linker.isTopLevel(entity),
    visibleAt: (module, offset) => linker.visibleAt(module, offset),
    overloadsOf: (functions) => linker.overloadsOf(functions),
    candidatesOf: ({ name }) => linker.variantsNamed(name),
    ownCallOf: (module, node) => linker.local(module)?.ownCalls.get(node),
    topLevelNamed: (module, name) => linker.topLevelNamed(module, name),
    aliasOf: (module, name) => linker.aliasOf(module, name),
    diagnosticsOf: (module) => linker.diagnosticsOf(module),
  };
}

class Linker {
  readonly #program: Program;
  readonly #locals: ReadonlyMap<ModuleId, ModuleBindings>;
  readonly #links = new Map<ModuleId, ModuleLinks>();
  readonly #owners = new Map<Entity, ModuleId>();
  readonly #topLevel = new Set<Entity>();
  readonly #variantsByName = new Map<string, VariantEntity[]>();
  readonly #variantsOfEnum = new Map<EnumDeclaration, ReadonlyMap<string, VariantEntity>>();
  readonly #overloads = new Map<FunctionsEntity, readonly FunctionDeclaration[]>();

  constructor(program: Program, locals: ReadonlyMap<ModuleId, ModuleBindings>) {
    this.#program = program;
    this.#locals = locals;
    for (const [id, local] of this.#locals) {
      this.#index(id, local);
    }
    for (const id of program.modules.keys()) {
      this.#linkTopLevel(id);
    }
    for (const id of program.modules.keys()) {
      this.#linkNames(id);
    }
  }

  local(module: ModuleId): ModuleBindings | undefined {
    return this.#locals.get(module);
  }

  entityOf(module: ModuleId, name: Identifier): Entity | undefined {
    const links = this.#links.get(module);
    return links === undefined || links.refused.has(name)
      ? undefined
      : (links.resolved.get(name) ?? resolvedImport(links, links.local.entities.get(name)));
  }

  /** What `name` denotes at the top level of `module`: its own name or import, or the prelude's. */
  topLevelNamed(module: ModuleId, name: string): Entity | undefined {
    const links = this.#links.get(module);
    const own = links?.local.topLevel.get(name)?.entity;
    const linked = links === undefined ? undefined : resolvedImport(links, own);
    return linked ?? this.#preludeFor(module)?.exports.get(name);
  }

  moduleOf(entity: Entity): ModuleId | undefined {
    return this.#owners.get(entity);
  }

  aliasOf(module: ModuleId, name: Identifier): Identifier | undefined {
    const local = this.#locals.get(module)?.entities.get(name);
    if (local?.kind !== 'import' || local.imported.name === name) {
      return undefined;
    }
    return local.imported.alias;
  }

  isTopLevel(entity: Entity): boolean {
    return this.#topLevel.has(entity);
  }

  /** The names visible at `offset` in `module`, resolved as a name written there would be. */
  visibleAt(module: ModuleId, offset: number): ReadonlyMap<string, Entity> {
    const links = this.#links.get(module);
    const tree = this.#program.modules.get(module)?.tree;
    if (links === undefined || tree === undefined) {
      return new Map();
    }
    const scoped = links.local.visibility.namesAt(tree, offset);
    const variants = [...this.#variantsByName.keys()].map(
      (name) => [name, links.local.variantsNamed(name)] as const,
    );
    const prelude = this.#preludeFor(module)?.exports ?? [];
    const linked = [...scoped].map(
      ([name, entity]) => [name, resolvedImport(links, entity)] as const,
    );
    // A later entry hides an earlier one, as a free name resolves; an import that failed hides too.
    const visible = new Map<string, Entity | undefined>([...variants, ...prelude, ...linked]);
    return new Map(
      [...visible].flatMap(([name, entity]) => (entity === undefined ? [] : [[name, entity]])),
    );
  }

  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    const links = this.#links.get(module);
    const tree = this.#program.modules.get(module)?.tree;
    return links === undefined || tree === undefined
      ? []
      : [...links.local.diagnostics, ...links.diagnostics].map((each) => diagnosticIn(tree, each));
  }

  variantsNamed(name: string): readonly VariantEntity[] {
    return this.#variantsByName.get(name) ?? [];
  }

  /** A module's function set with the prelude's overloads of its name, once per Program. */
  overloadsOf(functions: FunctionsEntity): readonly FunctionDeclaration[] {
    return memo(this.#overloads, functions, () => {
      const module = this.#owners.get(functions);
      const prelude = module === undefined ? undefined : this.#preludeFor(module);
      const joined = prelude?.exports.get(functions.name);
      return joined?.kind === 'functions'
        ? [...functions.overloads, ...joined.overloads]
        : functions.overloads;
    });
  }

  /** Resolves a module's imports and checks its top-level names against the prelude. */
  #linkTopLevel(id: ModuleId): void {
    const local = this.#locals.get(id);
    if (local === undefined) {
      return;
    }
    const links: ModuleLinks = {
      module: id,
      local,
      resolved: new Map(),
      imports: new Map(),
      refused: new Set(),
      diagnostics: [],
    };
    this.#links.set(id, links);
    for (const placeholder of local.imports) {
      const module = this.#program.modules.get(id)?.imports.get(placeholder.declaration);
      const entity =
        module === undefined ? undefined : this.#exported(module, placeholder.imported.name, links);
      if (entity !== undefined) {
        links.imports.set(placeholder, entity);
      }
    }
    meetPrelude(links, this.#preludeFor(id));
    checkTestImports(this.#program, id, links);
  }

  /** Resolves a module's free names, then the later parts of its qualified names. */
  #linkNames(id: ModuleId): void {
    const links = this.#links.get(id);
    if (links === undefined) {
      return;
    }
    for (const free of links.local.free) {
      this.#resolveFree(id, links, free);
    }
    for (const head of links.local.linkedHeads) {
      this.#refuseFunctionHead(id, links, head);
    }
    for (const path of links.local.paths) {
      this.#resolvePath(id, links, path);
    }
  }

  #index(id: ModuleId, local: ModuleBindings): void {
    for (const { entity } of local.topLevel.values()) {
      if (entity.kind !== 'import') {
        this.#owners.set(entity, id);
        this.#topLevel.add(entity);
      }
    }
    // What the tree's names denote and its scopes define is the tree's own, locals included, but
    // for what no module declares: placeholders, the shared primitives, a bare name's candidates.
    for (const entity of new Set([...local.entities.values(), ...local.defined])) {
      if (entity.kind !== 'import' && entity.kind !== 'primitive' && entity.kind !== 'variants') {
        this.#owners.set(entity, id);
      }
    }
    for (const [declaration, variants] of local.variants) {
      this.#variantsOfEnum.set(declaration, variants);
      for (const [name, variant] of variants) {
        this.#owners.set(variant, id);
        addToGroup(this.#variantsByName, name, variant);
      }
    }
  }

  /**
   * What the module of `links` sees as `name` of `module`, or a diagnostic saying why there is
   * none: its export, or, for a test module, its private declaration too, so a test can mock what
   * a module keeps private (§10).
   */
  #exported(module: ModuleId, name: Identifier, links: ModuleLinks): Entity | undefined {
    const target = this.#locals.get(module);
    const entity =
      target?.exports.get(name.text) ??
      (isTestModule(this.#program, links.module) ? target?.privates.get(name.text) : undefined);
    if (entity === undefined && target !== undefined) {
      const label = this.#program.modules.get(module)?.tree.source.path ?? module;
      links.diagnostics.push(
        target.privates.has(name.text)
          ? binderDiagnostics.privateExport(name.span, label, name.text)
          : binderDiagnostics.missingExport(name.span, label, name.text),
      );
    }
    return entity;
  }

  /** The prelude's bindings as module `id` sees them: every module but the prelude itself. */
  #preludeFor(id: ModuleId): ModuleBindings | undefined {
    const { prelude } = this.#program.roles;
    return prelude === undefined || prelude === id ? undefined : this.#locals.get(prelude);
  }

  #resolveFree(id: ModuleId, links: ModuleLinks, { name, role, miss, variants }: FreeName): void {
    const isVariant = variants !== undefined && this.variantsNamed(name.text).length > 0;
    const entity =
      this.#preludeFor(id)?.exports.get(name.text) ??
      (isVariant ? variants : undefined) ??
      (role === 'callee' && miss === undefined ? this.#unseenFunction(id, name.text) : undefined);
    if (entity !== undefined) {
      links.resolved.set(name, entity);
      return;
    }
    const explained = {
      pending: binderDiagnostics.usedBeforeDeclaration,
      ended: binderDiagnostics.blockEnded,
      underOr: binderDiagnostics.boundUnderOr,
    } as const;
    links.diagnostics.push(
      miss === undefined
        ? undeclaredName(name, role === 'assignment')
        : explained[miss](name.span, name.text),
    );
  }

  /**
   * A name before a `.` that names imported or prelude functions: none of them can enclose it (§7).
   */
  #refuseFunctionHead(id: ModuleId, links: ModuleLinks, head: Identifier): void {
    const entity = this.entityOf(id, head);
    if (entity?.kind === 'functions') {
      links.diagnostics.push(noOwnCall(head, entity));
      links.refused.add(head);
    }
  }

  #unseenFunction(id: ModuleId, name: string): FunctionsEntity {
    const { items } = programModule(this.#program, id).tree.root;
    const ofModule = unseenFunctions.get(items, () => new Map<string, FunctionsEntity>());
    const entity = memo(
      ofModule,
      name,
      () => ({ kind: 'functions', name, overloads: [] }) as const,
    );
    this.#owners.set(entity, id);
    return entity;
  }

  #resolvePath(id: ModuleId, links: ModuleLinks, { parts, role }: QualifiedPath): void {
    const inExpression = role === 'expression';
    const [head, ...rest] = parts;
    let qualifier = head;
    let current = this.entityOf(id, head);
    for (const part of rest) {
      const next = current === undefined ? undefined : this.#member(current, part, role, links);
      if (next === undefined) {
        // Outside an expression no check reads the parts before the last; in one, `x.y` reads a
        // value's member, which the checker reports. After a type, the parts are its associated
        // types (§3.1), which the checker resolves too.
        const associated = role === 'type' && current !== undefined && namesType(current);
        if (
          current !== undefined &&
          !inExpression &&
          !associated &&
          this.#qualifierOf(current) === undefined
        ) {
          links.diagnostics.push(binderDiagnostics.qualifiesNothing(part.span, qualifier.text));
        }
        return;
      }
      links.resolved.set(part, next);
      qualifier = part;
      current = next;
    }
  }

  /** The part after `current` in a qualified name, when a module or an enum supplies it. */
  #member(
    current: Entity,
    part: Identifier,
    role: QualifiedPath['role'],
    links: ModuleLinks,
  ): Entity | undefined {
    const qualifier = this.#qualifierOf(current);
    if (qualifier === undefined) {
      return;
    }
    if (qualifier.kind === 'namespace') {
      const module = this.#importedBy(qualifier);
      return module === undefined ? undefined : this.#exported(module, part, links);
    }
    const variant = this.#variantsOfEnum.get(qualifier.declaration)?.get(part.text);
    const associated = role === 'type' && declaresAssociated(qualifier.declaration, part);
    if (variant === undefined && role !== 'expression' && !associated) {
      const enumName = qualifier.declaration.name.text;
      links.diagnostics.push(binderDiagnostics.missingVariant(part.span, enumName, part.text));
    }
    return variant;
  }

  /** What `entity` qualifies a name's next part through, an alias the enum it stands for. */
  #qualifierOf(entity: Entity): Qualifier | undefined {
    return qualifierOf(this.#aliasLookup, entity);
  }

  readonly #aliasLookup: AliasLookup = {
    moduleOf: (entity) => this.moduleOf(entity),
    topLevelNamed: (module, name) => this.topLevelNamed(module, name),
    exportOf: (namespace, name) => {
      const module = this.#importedBy(namespace);
      return module === undefined ? undefined : this.#locals.get(module)?.exports.get(name);
    },
  };

  /** The module a namespace's import loaded. */
  #importedBy(namespace: NamespaceEntity): ModuleId | undefined {
    const importer = this.#owners.get(namespace);
    return importer === undefined
      ? undefined
      : this.#program.modules.get(importer)?.imports.get(namespace.declaration);
  }
}

/** Whether the enum `declaration` declares an associated type named as `part` (§3.1). */
function declaresAssociated(declaration: EnumDeclaration, part: Identifier): boolean {
  return declaration.associatedTypes.some((associated) => associated.name.text === part.text);
}
