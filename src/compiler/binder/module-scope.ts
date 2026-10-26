/**
 * A module's top level (§3, §3.7, §3.13): every name it declares or imports, defined before
 * anything inside a declaration is bound, so declarations may come in any order.
 *
 * - Top-level functions sharing a name form one overload set (§3.7). A static function
 *   (`fn Duration.zero()`) belongs to its type, so it defines no name here. A handle's functions
 *   join the sets as written ones do, where the handle is declared (§3.18).
 * - Any other name defined twice is an error. The message says which rule was broken: a name
 *   imported twice, an import clashing with a declaration (§3.13), or a plain duplicate.
 * - A named import is a placeholder until the program is linked; a namespace import is already
 *   its entity, since the program records which module its path loaded. A module's exports are
 *   its own declarations whose names don't start with `_`; imported names are never re-exported.
 * - Each enum's variants get their entities here, so a qualified variant (`Decision.Expired`) and
 *   a bare one chosen by expected type resolve to the same entity.
 */

import type {
  Declaration,
  EnumDeclaration,
  FunctionDeclaration,
  Module,
} from '../syntax/declarations.ts';
import { declaredFunctions, handleFunctionList } from '../syntax/declared-functions.ts';
import type { Identifier } from '../syntax/node.ts';
import { targetNames } from '../syntax/patterns.ts';
import { binderDiagnostics } from './diagnostics.ts';
import type { Entity, FunctionsEntity, VariantEntity } from './entities.ts';
import type { LocalBinder } from './local-binder.ts';
import { type Convention, isPrivate } from './naming.ts';
import { type ImportPlaceholder, type LocalEntity, Scope } from './scope.ts';

/** A top-level name and the identifier that first declared it. */
interface TopLevelName {
  readonly name: Identifier;
  readonly entity: LocalEntity;
}

export interface ModuleScope {
  readonly scope: Scope;
  readonly topLevel: ReadonlyMap<string, TopLevelName>;
  readonly imports: readonly ImportPlaceholder[];
  /** Each enum's variants by name. */
  readonly variants: ReadonlyMap<EnumDeclaration, ReadonlyMap<string, VariantEntity>>;
  readonly exports: ReadonlyMap<string, Entity>;
  /** The module's own declarations its exports leave out because a leading `_` keeps them private. */
  readonly privateNames: ReadonlySet<string>;
}

type Origin = 'import' | 'declaration';

/** Defines every top-level name of `module` in a new scope under `parent`. */
export function defineModuleScope(binder: LocalBinder, module: Module, parent: Scope): ModuleScope {
  const definer = new TopLevelDefiner(binder, Scope.block(parent), functionSets(module));
  for (const item of module.items) {
    if (item.kind !== 'Invalid') {
      definer.defineItem(item);
    }
  }
  return {
    scope: definer.scope,
    topLevel: definer.topLevel,
    imports: definer.imports,
    variants: variantsOf(binder, module),
    ...ownNames(definer.topLevel),
  };
}

class TopLevelDefiner {
  readonly scope: Scope;
  readonly topLevel = new Map<string, TopLevelName & { readonly origin: Origin }>();
  readonly imports: ImportPlaceholder[] = [];
  readonly #binder: LocalBinder;
  readonly #functionSets: ReadonlyMap<string, FunctionsEntity>;

  constructor(binder: LocalBinder, scope: Scope, functions: ReadonlyMap<string, FunctionsEntity>) {
    this.#binder = binder;
    this.scope = scope;
    this.#functionSets = functions;
  }

  defineItem(item: Declaration): void {
    switch (item.kind) {
      case 'NamedImport':
        for (const name of item.names) {
          const placeholder: ImportPlaceholder = { kind: 'import', name, declaration: item };
          if (this.#define(name, placeholder, 'import', undefined)) {
            this.imports.push(placeholder);
          }
        }
        return;
      case 'NamespaceImport':
        this.#define(item.alias, { kind: 'namespace', declaration: item }, 'import', 'value');
        return;
      case 'FunctionDeclaration':
        this.#defineFunction(item);
        return;
      case 'ExternConstantDeclaration': {
        const { name } = item;
        this.#define(name, { kind: 'variable', name, owner: item }, 'declaration', 'value');
        return;
      }
      case 'VariableDeclaration':
        for (const name of item.targets.flatMap(targetNames)) {
          this.#define(name, { kind: 'variable', name, owner: item }, 'declaration', 'value');
        }
        return;
      case 'HandleDeclaration':
        this.#define(item.name, { kind: 'type', declaration: item }, 'declaration', 'type');
        for (const declared of handleFunctionList(item)) {
          this.#defineFunction(declared);
        }
        return;
      default:
        this.#define(item.name, { kind: 'type', declaration: item }, 'declaration', 'type');
    }
  }

  #define(
    name: Identifier,
    entity: LocalEntity,
    origin: Origin,
    convention: Convention | undefined,
  ): boolean {
    const clash = clashRule(this.topLevel.get(name.text)?.origin, origin);
    const rules = convention === undefined ? { clash } : { convention, clash };
    const defined = this.#binder.declare(this.scope, name, entity, rules);
    if (defined) {
      this.topLevel.set(name.text, { name, entity, origin });
    }
    return defined;
  }

  /** The first overload defines its set's name; a later one, or a static function, defines none. */
  #defineFunction(node: FunctionDeclaration): void {
    const set = node.owner === undefined ? this.#functionSets.get(node.name.text) : undefined;
    if (set !== undefined && set.overloads[0] === node) {
      this.#define(node.name, set, 'declaration', 'value');
      return;
    }
    this.#binder.checkConvention(node.name, 'value');
    if (set !== undefined) {
      this.#binder.record(node.name, set);
    }
  }
}

/** Which rule a second top-level definition of a name breaks (§3.13). */
function clashRule(previous: Origin | undefined, current: Origin) {
  if (previous === 'import' && current === 'import') {
    return binderDiagnostics.duplicateImport;
  }
  return previous === 'import' || current === 'import'
    ? binderDiagnostics.importClash
    : binderDiagnostics.duplicateDeclaration;
}

/**
 * A module's own declarations, exported or kept private by a leading `_`; imports are never
 * re-exported (§3.13).
 */
function ownNames(
  topLevel: ReadonlyMap<string, TopLevelName>,
): Pick<ModuleScope, 'exports' | 'privateNames'> {
  const exports = new Map<string, Entity>();
  const privateNames = new Set<string>();
  for (const [text, { entity }] of topLevel) {
    const isOwn = entity.kind !== 'import' && entity.kind !== 'namespace';
    if (isOwn && isPrivate(text)) {
      privateNames.add(text);
    } else if (isOwn) {
      exports.set(text, entity);
    }
  }
  return { exports, privateNames };
}

/** A set per name of the top-level functions; static functions belong to their type instead. */
function functionSets(module: Module): ReadonlyMap<string, FunctionsEntity> {
  const sets = new Map<string, FunctionDeclaration[]>();
  for (const declared of declaredFunctions(module)) {
    if (declared.owner === undefined) {
      sets.set(declared.name.text, [...(sets.get(declared.name.text) ?? []), declared]);
    }
  }
  return new Map(
    [...sets].map(([name, overloads]) => [name, { kind: 'functions', name, overloads }] as const),
  );
}

function variantsOf(
  binder: LocalBinder,
  module: Module,
): ReadonlyMap<EnumDeclaration, ReadonlyMap<string, VariantEntity>> {
  const enums = module.items.filter((item) => item.kind === 'EnumDeclaration');
  return new Map(
    enums.map((declaration) => {
      const variants = declaration.variants.filter((variant) => variant.kind === 'Variant');
      binder.checkMemberNames(
        variants.map((variant) => variant.name),
        'type',
      );
      const byName = new Map<string, VariantEntity>();
      for (const variant of variants) {
        const entity: VariantEntity = { kind: 'variant', enum: declaration, variant };
        binder.record(variant.name, entity);
        byName.set(variant.name.text, entity);
      }
      return [declaration, byName];
    }),
  );
}
