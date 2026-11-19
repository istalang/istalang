/**
 * Linking: what every module's bindings leave open, resolved across the program (§5.3, §13.1).
 *
 * - An import names an export of the module its path loaded. A private name (`_x`) is reported as
 *   private, anything else missing as not exported. `import *` binds every export
 *   (star-imports.ts), which a free name finds before the prelude's; a use it makes ambiguous is
 *   reported there.
 * - Only a test module may import `testing`, or another test module (§18).
 * - The prelude is every module's outer scope. Reusing one of its names at the top level is an
 *   error, except for a function, declared or imported, which joins the prelude's overloads of its
 *   name, as a module's `fn add(left: Time, right: Duration)` joins the prelude's `add(Int, Float)`
 *   (§10.2).
 * - A name still free after the prelude may be a variant that only the expected type identifies,
 *   if some enum of the program has a variant by that name. A called name may name functions only
 *   argument-dependent lookup finds (§13.1), so it denotes a function set with no overloads of its
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

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { addToGroup } from '../../../foundation/structures/groups.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { type ModuleId, type Program, programModule } from '../../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  ImportDeclaration,
} from '../../syntax/declarations/index.ts';
import type { Identifier, NodeOf } from '../../syntax/tree/node.ts';
import { diagnosticIn } from '../../syntax/tree/positions.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import {
  type Bindings,
  type Entity,
  type FunctionsEntity,
  type NamespaceEntity,
  namesType,
  type Qualifier,
  type VariableEntity,
  type VariantEntity,
} from '../entities.ts';
import { type ModuleBindings, transientsOf } from '../module/bind-module.ts';
import type { FreeName, QualifiedPath } from '../module/local-binder.ts';
import { noOwnCall } from '../module/own-calls.ts';
import { unresolvedName } from '../naming.ts';
import {
  declaresAtTopLevel,
  moduleDeclaring,
  moduleOfDeclarationNode,
  moduleOfItemNode,
} from './declaring.ts';
import { exportedTo, type LinkedModules } from './exported.ts';
import { type ModuleLinks, resolvedImport } from './module-links.ts';
import { type AliasLookup, qualifierOf } from './qualifiers.ts';
import {
  beyondTopLevel,
  linkStarImports,
  refuseAmbiguousUses,
  unambiguous,
} from './star-imports.ts';
import { checkTestImports, meetPrelude } from './top-level-rules.ts';
import { unseenFunction } from './unseen-functions.ts';

/** Every module's own bindings (`locals`), linked across `program`. */
export function link(program: Program, locals: ReadonlyMap<ModuleId, ModuleBindings>): Bindings {
  const linker = new Linker(program, locals);
  return {
    entityOf: (module, name) => linker.entityOf(module, name),
    exportsOf: (module) => linker.local(module)?.exports ?? new Map(),
    moduleOf: (entity) => linker.moduleOf(entity),
    isTopLevel: (entity) => linker.isTopLevel(entity),
    itemModuleOf: (node) => linker.itemModuleOf(node),
    declarationModuleOf: (node) => linker.declarationModuleOf(node),
    visibleAt: (module, offset) => linker.visibleAt(module, offset),
    overloadsOf: (functions) => linker.overloadsOf(functions),
    candidatesOf: ({ name }) => linker.variantsNamed(name),
    ownCallOf: (module, node) => linker.local(module)?.ownCalls.get(node),
    topLevelNamed: (module, name) => linker.topLevelNamed(module, name),
    topLevelNames: (module) => linker.topLevelNames(module),
    transientsOf: (module) => linker.transientsOf(module),
    aliasOf: (module, name) => linker.aliasOf(module, name),
    diagnosticsOf: (module) => linker.diagnosticsOf(module),
  };
}

class Linker {
  readonly #program: Program;
  readonly #locals: ReadonlyMap<ModuleId, ModuleBindings>;
  readonly #modules: LinkedModules;
  readonly #links = new Map<ModuleId, ModuleLinks>();
  /** The empty function sets this program's called names left to argument-dependent lookup. */
  readonly #unseen = new Set<FunctionsEntity>();
  readonly #variantsByName = new Map<string, VariantEntity[]>();
  readonly #variantsOfEnum = new Map<EnumDeclaration, ReadonlyMap<string, VariantEntity>>();
  readonly #overloads = new Map<FunctionsEntity, readonly FunctionDeclaration[]>();
  readonly #beyond = new Map<ModuleId, ReadonlyMap<string, readonly Entity[]>>();
  readonly #beyondOne = new Map<ModuleId, ReadonlyMap<string, Entity>>();

  constructor(program: Program, locals: ReadonlyMap<ModuleId, ModuleBindings>) {
    this.#program = program;
    this.#locals = locals;
    this.#modules = { program, locals };
    for (const local of this.#locals.values()) {
      this.#indexVariants(local);
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

  /** What `name` denotes at the top level of `module`: its own name or import, else beyond it. */
  topLevelNamed(module: ModuleId, name: string): Entity | undefined {
    const links = this.#links.get(module);
    const own = links?.local.topLevel.get(name)?.entity;
    const linked = links === undefined ? undefined : resolvedImport(links, own);
    return linked ?? this.#unambiguous(module).get(name);
  }

  topLevelNames(module: ModuleId): readonly string[] {
    const own = this.#links.get(module)?.local.topLevel.keys() ?? [];
    return [...new Set([...own, ...this.#unambiguous(module).keys()])];
  }

  /**
   * What `module` sees past its own top level, per name (star-imports.ts `beyondTopLevel`): the
   * one home of the order a free name resolves in, which every lookup reads.
   */
  #beyondTopLevel(module: ModuleId): ReadonlyMap<string, readonly Entity[]> {
    return memo(this.#beyond, module, () =>
      beyondTopLevel(this.#links.get(module)?.starred ?? new Map(), this.#preludeFor(module)),
    );
  }

  /** The names beyond `module`'s top level that denote one entity, each with it. */
  #unambiguous(module: ModuleId): ReadonlyMap<string, Entity> {
    return memo(this.#beyondOne, module, () => unambiguous(this.#beyondTopLevel(module)));
  }

  transientsOf(module: ModuleId): readonly VariableEntity[] {
    const local = this.local(module);
    return local === undefined ? [] : transientsOf(local);
  }

  moduleOf(entity: Entity): ModuleId | undefined {
    return moduleDeclaring(this.#locals, entity, this.#unseen);
  }

  aliasOf(module: ModuleId, name: Identifier): Identifier | undefined {
    const local = this.#locals.get(module)?.entities.get(name);
    if (local?.kind !== 'import' || local.imported.name === name) {
      return undefined;
    }
    return local.imported.alias;
  }

  itemModuleOf(node: NodeOf<string>): ModuleId | undefined {
    return moduleOfItemNode(this.#locals, node);
  }

  declarationModuleOf(node: NodeOf<string>): ModuleId | undefined {
    return moduleOfDeclarationNode(this.#locals, node);
  }

  isTopLevel(entity: Entity): boolean {
    return declaresAtTopLevel(this.#locals, entity);
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
    const linked = [...scoped].map(
      ([name, entity]) => [name, resolvedImport(links, entity)] as const,
    );
    // A later entry hides an earlier one, as a free name resolves; an import that failed hides too.
    const visible = new Map<string, Entity | undefined>([
      ...variants,
      ...this.#unambiguous(module),
      ...linked,
    ]);
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
      const module = this.moduleOf(functions);
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
    const starred = linkStarImports(local, {
      loadedBy: (declaration) => this.#loadedBy(id, declaration),
      exportsOf: (module) => this.#locals.get(module)?.exports,
    });
    const links: ModuleLinks = {
      module: id,
      local,
      resolved: new Map(),
      imports: new Map(),
      starred,
      refused: new Set(),
      diagnostics: [],
    };
    this.#links.set(id, links);
    for (const placeholder of local.imports) {
      const module = this.#loadedBy(id, placeholder.declaration);
      const entity =
        module === undefined
          ? undefined
          : exportedTo(this.#modules, links, module, placeholder.imported.name);
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
    refuseAmbiguousUses(links);
    for (const head of links.local.linkedHeads) {
      this.#refuseFunctionHead(id, links, head);
    }
    for (const path of links.local.paths) {
      this.#resolvePath(id, links, path);
    }
  }

  #indexVariants(local: ModuleBindings): void {
    for (const [declaration, variants] of local.variants) {
      this.#variantsOfEnum.set(declaration, variants);
      for (const [name, variant] of variants) {
        addToGroup(this.#variantsByName, name, variant);
      }
    }
  }

  /** The prelude's bindings as module `id` sees them: every module but the prelude itself. */
  #preludeFor(id: ModuleId): ModuleBindings | undefined {
    const { prelude } = this.#program.roles;
    return prelude === undefined || prelude === id ? undefined : this.#locals.get(prelude);
  }

  #resolveFree(id: ModuleId, links: ModuleLinks, { name, role, miss, variants }: FreeName): void {
    const [beyond, ...others] = this.#beyondTopLevel(id).get(name.text) ?? [];
    if (others.length > 0) {
      links.diagnostics.push(binderDiagnostics.ambiguousName(name.span, name.text));
      return;
    }
    const isVariant = variants !== undefined && this.variantsNamed(name.text).length > 0;
    const entity =
      beyond ??
      (isVariant ? variants : undefined) ??
      (role === 'callee' && miss === undefined ? this.#unseenFunction(id, name.text) : undefined);
    if (entity !== undefined) {
      links.resolved.set(name, entity);
      return;
    }
    links.diagnostics.push(unresolvedName(name, role === 'assignment', miss));
  }

  /**
   * A name before a `.` that names imported or prelude functions: none of them can enclose it (§16).
   */
  #refuseFunctionHead(id: ModuleId, links: ModuleLinks, head: Identifier): void {
    const entity = this.entityOf(id, head);
    if (entity?.kind === 'functions') {
      links.diagnostics.push(noOwnCall(head, undefined));
      links.refused.add(head);
    }
  }

  #unseenFunction(id: ModuleId, name: string): FunctionsEntity {
    const entity = unseenFunction(id, programModule(this.#program, id).tree.root.items, name);
    this.#unseen.add(entity);
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
        // types (§5.2), which the checker resolves too.
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
      return module === undefined ? undefined : exportedTo(this.#modules, links, module, part);
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
    const importer = this.moduleOf(namespace);
    return importer === undefined ? undefined : this.#loadedBy(importer, namespace.declaration);
  }

  /** The module `declaration`, an import of module `importer`, loaded. */
  #loadedBy(importer: ModuleId, declaration: ImportDeclaration): ModuleId | undefined {
    return this.#program.modules.get(importer)?.imports.get(declaration);
  }
}

/** Whether the enum `declaration` declares an associated type named as `part` (§5.2). */
function declaresAssociated(declaration: EnumDeclaration, part: Identifier): boolean {
  return declaration.associatedTypes.some((associated) => associated.name.text === part.text);
}
