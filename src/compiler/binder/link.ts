/**
 * Linking: what every module's bindings leave open, resolved across the program (§3.11, §3.13).
 *
 * - An import names an export of the module its path loaded. A private name (`_x`) is reported as
 *   private, anything else missing as not exported.
 * - The prelude is every module's outer scope. Reusing one of its names at the top level is an
 *   error, except for a function, declared or imported, which joins the prelude's overloads of its
 *   name, as a module's `fn add(left: Time, right: Duration)` joins the prelude's `add(int, float)`
 *   (§3.9).
 * - A name still free after the prelude may be a variant that only the expected type identifies,
 *   if some enum of the program has a variant by that name; otherwise it is reported with the
 *   reason its scopes noted, or as undeclared.
 * - A qualified name walks through modules and enums part by part, and stops at the first part
 *   that is neither: what follows is a member, the checker's to resolve. In an expression, a part
 *   an enum lacks may be a static function (`Color.default()`), so only a pattern or type reports
 *   it as a missing variant.
 *
 * Linking makes no entities: it maps names to the ones each tree made, so their identities hold
 * across snapshots. What depends on the whole program (a function set joined with the prelude's,
 * a bare name's candidate variants) is answered per query and memoized on the Program.
 *
 * Imported names are never re-exported, so resolving one module's imports needs only the others'
 * own declarations, and linking needs no fixpoint even when imports form cycles. Every module's
 * imports and top level are linked before any module's free names, since a free name may resolve
 * to what an import brought in; the Linker runs both passes as it is made, in that order.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { EnumDeclaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Identifier } from '../syntax/node.ts';
import { bindModule, type ModuleBindings } from './bind-module.ts';
import { binderDiagnostics } from './diagnostics.ts';
import type {
  Bindings,
  Entity,
  FunctionsEntity,
  NamespaceEntity,
  VariantEntity,
} from './entities.ts';
import type { FreeName, QualifiedPath } from './local-binder.ts';
import type { ImportPlaceholder, LocalEntity } from './scope.ts';

interface ModuleLinks {
  readonly local: ModuleBindings;
  /** Free names and the later parts of qualified names. */
  readonly resolved: Map<Identifier, Entity>;
  readonly imports: Map<ImportPlaceholder, Entity>;
  readonly diagnostics: Diagnostic[];
}

export function link(program: Program): Bindings {
  const linker = new Linker(program);
  return {
    entityOf: (module, name) => linker.entityOf(module, name),
    exportsOf: (module) => linker.local(module)?.exports ?? new Map(),
    moduleOf: (entity) => linker.moduleOf(entity),
    overloadsOf: (functions) => linker.overloadsOf(functions),
    candidatesOf: ({ name }) => linker.variantsNamed(name),
    diagnosticsOf: (module) => linker.diagnosticsOf(module),
  };
}

class Linker {
  readonly #program: Program;
  readonly #locals: ReadonlyMap<ModuleId, ModuleBindings>;
  readonly #links = new Map<ModuleId, ModuleLinks>();
  readonly #owners = new Map<Entity, ModuleId>();
  readonly #variantsByName = new Map<string, VariantEntity[]>();
  readonly #variantsOfEnum = new Map<EnumDeclaration, ReadonlyMap<string, VariantEntity>>();
  readonly #overloads = new Map<FunctionsEntity, readonly FunctionDeclaration[]>();

  constructor(program: Program) {
    this.#program = program;
    this.#locals = new Map(
      [...program.modules].map(([id, module]) => [id, bindModule(module.tree)] as const),
    );
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
    return links === undefined
      ? undefined
      : (links.resolved.get(name) ?? resolvedImport(links, links.local.entities.get(name)));
  }

  moduleOf(entity: Entity): ModuleId | undefined {
    return this.#owners.get(entity);
  }

  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    const links = this.#links.get(module);
    return links === undefined ? [] : [...links.local.diagnostics, ...links.diagnostics];
  }

  variantsNamed(name: string): readonly VariantEntity[] {
    return this.#variantsByName.get(name) ?? [];
  }

  /** A module's function set with the prelude's overloads of its name, once per Program. */
  overloadsOf(functions: FunctionsEntity): readonly FunctionDeclaration[] {
    let overloads = this.#overloads.get(functions);
    if (overloads === undefined) {
      const module = this.#owners.get(functions);
      const prelude = module === undefined ? undefined : this.#preludeFor(module);
      const joined = prelude?.exports.get(functions.name);
      overloads =
        joined?.kind === 'functions'
          ? [...functions.overloads, ...joined.overloads]
          : functions.overloads;
      this.#overloads.set(functions, overloads);
    }
    return overloads;
  }

  /** Resolves a module's imports and checks its top-level names against the prelude. */
  #linkTopLevel(id: ModuleId): void {
    const local = this.#locals.get(id);
    if (local === undefined) {
      return;
    }
    const links: ModuleLinks = { local, resolved: new Map(), imports: new Map(), diagnostics: [] };
    this.#links.set(id, links);
    for (const placeholder of local.imports) {
      const module = this.#program.modules.get(id)?.imports.get(placeholder.declaration);
      const entity =
        module === undefined ? undefined : this.#exported(module, placeholder.name, links);
      if (entity !== undefined) {
        links.imports.set(placeholder, entity);
      }
    }
    this.#meetPrelude(id, links);
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
    for (const path of links.local.paths) {
      this.#resolvePath(id, links, path);
    }
  }

  #index(id: ModuleId, local: ModuleBindings): void {
    for (const { entity } of local.topLevel.values()) {
      if (entity.kind !== 'import') {
        this.#owners.set(entity, id);
      }
    }
    for (const [declaration, variants] of local.variants) {
      this.#variantsOfEnum.set(declaration, variants);
      for (const [name, variant] of variants) {
        this.#owners.set(variant, id);
        this.#variantsByName.set(name, [...this.variantsNamed(name), variant]);
      }
    }
  }

  /** The export `name` of `module`, or a diagnostic saying why there is none. */
  #exported(module: ModuleId, name: Identifier, links: ModuleLinks): Entity | undefined {
    const target = this.#locals.get(module);
    const entity = target?.exports.get(name.text);
    if (entity === undefined && target !== undefined) {
      const label = this.#program.modules.get(module)?.tree.source.path ?? module;
      links.diagnostics.push(
        target.privateNames.has(name.text)
          ? binderDiagnostics.privateExport(name.span, label, name.text)
          : binderDiagnostics.missingExport(name.span, label, name.text),
      );
    }
    return entity;
  }

  /**
   * Top-level names may not reuse the prelude's, except functions, declared or imported, which
   * join its overloads. An import that failed to resolve was reported already.
   */
  #meetPrelude(id: ModuleId, links: ModuleLinks): void {
    const prelude = this.#preludeFor(id);
    for (const [text, { name, entity }] of links.local.topLevel) {
      const preludeEntity = prelude?.exports.get(text);
      const linked = resolvedImport(links, entity);
      const joins = linked?.kind === 'functions' && preludeEntity?.kind === 'functions';
      if (preludeEntity !== undefined && linked !== undefined && !joins) {
        links.diagnostics.push(binderDiagnostics.preludeClash(name.span, text));
      }
    }
  }

  /** The prelude's bindings as module `id` sees them: every module but the prelude itself. */
  #preludeFor(id: ModuleId): ModuleBindings | undefined {
    const { prelude } = this.#program;
    return prelude === undefined || prelude === id ? undefined : this.#locals.get(prelude);
  }

  #resolveFree(id: ModuleId, links: ModuleLinks, { name, role, miss, variants }: FreeName): void {
    const isVariant = variants !== undefined && this.variantsNamed(name.text).length > 0;
    const entity =
      this.#preludeFor(id)?.exports.get(name.text) ?? (isVariant ? variants : undefined);
    if (entity !== undefined) {
      links.resolved.set(name, entity);
      return;
    }
    const explained = {
      pending: binderDiagnostics.usedBeforeDeclaration,
      ended: binderDiagnostics.blockEnded,
      underOr: binderDiagnostics.boundUnderOr,
    } as const;
    const unexplained =
      role === 'assignment'
        ? binderDiagnostics.assignmentToUndeclared
        : binderDiagnostics.undeclared;
    links.diagnostics.push(
      (miss === undefined ? unexplained : explained[miss])(name.span, name.text),
    );
  }

  #resolvePath(id: ModuleId, links: ModuleLinks, { parts, inExpression }: QualifiedPath): void {
    const [head, ...rest] = parts;
    let current = this.entityOf(id, head);
    for (const part of rest) {
      current =
        current === undefined ? undefined : this.#member(current, part, inExpression, links);
      if (current === undefined) {
        return;
      }
      links.resolved.set(part, current);
    }
  }

  /** The part after `current` in a qualified name, when a module or an enum supplies it. */
  #member(
    current: Entity,
    part: Identifier,
    inExpression: boolean,
    links: ModuleLinks,
  ): Entity | undefined {
    if (current.kind === 'namespace') {
      const module = this.#importedBy(current);
      return module === undefined ? undefined : this.#exported(module, part, links);
    }
    if (current.kind !== 'type' || current.declaration.kind !== 'EnumDeclaration') {
      return;
    }
    const variant = this.#variantsOfEnum.get(current.declaration)?.get(part.text);
    if (variant === undefined && !inExpression) {
      const enumName = current.declaration.name.text;
      links.diagnostics.push(binderDiagnostics.missingVariant(part.span, enumName, part.text));
    }
    return variant;
  }

  /** The module a namespace's import loaded. */
  #importedBy(namespace: NamespaceEntity): ModuleId | undefined {
    const importer = this.#owners.get(namespace);
    return importer === undefined
      ? undefined
      : this.#program.modules.get(importer)?.imports.get(namespace.declaration);
  }
}

/** What a module-local entity denotes once linked: an import's target, or the entity itself. */
function resolvedImport(links: ModuleLinks, entity: LocalEntity | undefined): Entity | undefined {
  return entity?.kind === 'import' ? links.imports.get(entity) : entity;
}
