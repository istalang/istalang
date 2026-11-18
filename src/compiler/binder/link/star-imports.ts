/**
 * `import * from 'path'` (§3.13): every export of the module the path loaded, bound under its own
 * name, as if the import listed each. Its names are known only once the program is, so they are
 * bound while linking, and a free name finds them before the prelude's (index.ts).
 *
 * No name is bound twice, so nothing shadows implicitly: a name a `*` brings that the module's top
 * level already binds, by a declaration or an import, or that an earlier `*` brought, is reported
 * on the `*`, and the explicit binding, or the earlier `*`'s, keeps it. A prelude name is reused
 * as by any import: only a function joins the prelude's overloads (top-level-rules.ts).
 *
 * Only exports are brought, never a private name, even into a test module, which names a private
 * declaration only by importing it by name (§10).
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../program/program.ts';
import type { ImportDeclaration } from '../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import type { Entity } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import { reusesPrelude } from './top-level-rules.ts';

/** What one module's `*` imports read: the module an import loaded, its exports, the prelude. */
export interface StarImportSources {
  readonly loadedBy: (declaration: ImportDeclaration) => ModuleId | undefined;
  readonly exportsOf: (module: ModuleId) => ReadonlyMap<string, Entity> | undefined;
  readonly prelude: ModuleBindings | undefined;
}

/** The names the module `local` bound binds through its `*` imports, each clash reported. */
export function linkStarImports(
  local: ModuleBindings,
  diagnostics: Diagnostic<AnchoredSpan>[],
  sources: StarImportSources,
): ReadonlyMap<string, Entity> {
  const starred = new Map<string, Entity>();
  for (const { imported, declaration } of local.starImports) {
    const module = sources.loadedBy(declaration);
    const exports = module === undefined ? undefined : sources.exportsOf(module);
    for (const [text, entity] of exports ?? []) {
      const clash = clashOf(local, starred, text);
      if (clash !== undefined) {
        diagnostics.push(clash(imported.span, text));
      } else if (reusesPrelude(text, entity, sources.prelude)) {
        diagnostics.push(binderDiagnostics.preludeClash(imported.span, text));
      } else {
        starred.set(text, entity);
      }
    }
  }
  return starred;
}

/** The rule a `*` binding `text` breaks against what the module bound before, if any. */
function clashOf(local: ModuleBindings, starred: ReadonlyMap<string, Entity>, text: string) {
  if (starred.has(text)) {
    return binderDiagnostics.duplicateImport;
  }
  const own = local.topLevel.get(text)?.entity;
  if (own === undefined) {
    return;
  }
  return own.kind === 'import' || own.kind === 'namespace'
    ? binderDiagnostics.duplicateImport
    : binderDiagnostics.importClash;
}
