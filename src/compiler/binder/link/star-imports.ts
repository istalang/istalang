/**
 * `import * from 'path'` (§13.1): every export of the module the path loaded, bound under its own
 * name, as if the import listed each. Its names are known only once the program is, so linking
 * binds them, and a free name finds them before the prelude's (index.ts).
 *
 * A name is ambiguous only where it is used, never where it is imported: a use finding two
 * different things, through two `*` imports, a `*` and the module's own declaration or import, or
 * a `*` and the prelude, is reported there (index.ts). An unused one costs nothing, so a module
 * adding an export breaks no importer that doesn't use it. Two ways to one entity are one, and a
 * function a `*` brings joins the prelude's overloads of its name, as one imported by name does
 * (top-level-rules.ts).
 *
 * Only exports are brought, never a private name, even into a test module, which names a private
 * declaration only by importing it by name (§18).
 */

import type { ModuleId } from '../../program/program.ts';
import type { ImportDeclaration } from '../../syntax/declarations/index.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import type { Entity } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import { type ModuleLinks, resolvedImport } from './module-links.ts';
import { reusesPrelude } from './top-level-rules.ts';

/** What one module's `*` imports read: the module an import loaded, and that module's exports. */
export interface StarImportSources {
  readonly loadedBy: (declaration: ImportDeclaration) => ModuleId | undefined;
  readonly exportsOf: (module: ModuleId) => ReadonlyMap<string, Entity> | undefined;
}

/** Per name, the distinct entities the `*` imports of the module `local` bound bind. */
export function linkStarImports(
  local: ModuleBindings,
  sources: StarImportSources,
): ReadonlyMap<string, readonly Entity[]> {
  const starred = new Map<string, Entity[]>();
  for (const { declaration } of local.starImports) {
    const module = sources.loadedBy(declaration);
    const exports = module === undefined ? undefined : sources.exportsOf(module);
    for (const [text, entity] of exports ?? []) {
      const known = starred.get(text);
      if (known === undefined) {
        starred.set(text, [entity]);
      } else if (!known.includes(entity)) {
        known.push(entity);
      }
    }
  }
  return starred;
}

/**
 * Per name, what a module sees past its own top level: the distinct entities its `*` imports bind,
 * with the prelude's beside them unless each joins it, else the prelude's alone. One entity is
 * what the name denotes; several make a use of it ambiguous (banner).
 */
export function beyondTopLevel(
  starred: ReadonlyMap<string, readonly Entity[]>,
  prelude: ModuleBindings | undefined,
): ReadonlyMap<string, readonly Entity[]> {
  const beyond = new Map<string, readonly Entity[]>(
    [...(prelude?.exports ?? [])].map(([text, entity]) => [text, [entity]]),
  );
  for (const [text, entities] of starred) {
    const preludeEntity = prelude?.exports.get(text);
    const reuses = entities.some((entity) => reusesPrelude(text, entity, prelude));
    beyond.set(
      text,
      preludeEntity !== undefined && reuses ? [...entities, preludeEntity] : entities,
    );
  }
  return beyond;
}

/** The names of `beyond` that denote one entity, each with it. */
export function unambiguous(
  beyond: ReadonlyMap<string, readonly Entity[]>,
): ReadonlyMap<string, Entity> {
  return new Map(
    [...beyond].flatMap(([text, [only, ...rest]]) =>
      only === undefined || rest.length > 0 ? [] : [[text, only] as const],
    ),
  );
}

/**
 * Reports, and refuses, each use in `links`'s module of a name its own top level declares or
 * imports that a `*` import gives something else too.
 */
export function refuseAmbiguousUses(links: ModuleLinks): void {
  for (const use of links.local.topLevelUses) {
    const own = resolvedImport(links, links.local.entities.get(use));
    const starred = links.starred.get(use.text) ?? [];
    if (own !== undefined && starred.some((entity) => entity !== own)) {
      links.diagnostics.push(binderDiagnostics.ambiguousName(use.span, use.text));
      links.refused.add(use);
    }
  }
}
