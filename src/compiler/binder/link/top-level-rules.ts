/**
 * What a module's top level must keep against the rest of the program, checked once its imports
 * are linked (§3.9, §3.13, §10): its names don't reuse the prelude's, but for functions, which join
 * its overloads; and only a test module imports `testing`, or another test module, so production
 * code can never install a mock.
 */

import { isTestModule, type ModuleId, type Program } from '../../program/program.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import type { Entity } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import { type ModuleLinks, resolvedImport } from './module-links.ts';

/**
 * Reports each top-level name of `links`'s module that reuses one of `prelude`'s, as the module
 * sees it (`reusesPrelude`). An import that failed to resolve was reported already.
 */
export function meetPrelude(links: ModuleLinks, prelude: ModuleBindings | undefined): void {
  for (const [text, { name, entity }] of links.local.topLevel) {
    const linked = resolvedImport(links, entity);
    if (linked !== undefined && reusesPrelude(text, linked, prelude)) {
      links.diagnostics.push(binderDiagnostics.preludeClash(name.span, text));
    }
  }
}

/**
 * Whether binding `entity` as `text` at a module's top level reuses one of `prelude`'s names,
 * unless both are functions of that name. An overload set joins the prelude's by its own name
 * (index.ts `overloadsOf`), so a function an import renames to a prelude name joins nothing and
 * clashes.
 */
export function reusesPrelude(
  text: string,
  entity: Entity,
  prelude: ModuleBindings | undefined,
): boolean {
  const preludeEntity = prelude?.exports.get(text);
  const joins =
    entity.kind === 'functions' && entity.name === text && preludeEntity?.kind === 'functions';
  return preludeEntity !== undefined && !joins;
}

/** Reports each import of `testing` or of a test module by `id`, unless `id` is a test module. */
export function checkTestImports(program: Program, id: ModuleId, links: ModuleLinks): void {
  const module = program.modules.get(id);
  if (module === undefined || isTestModule(program, id)) {
    return;
  }
  for (const [declaration, imported] of module.imports) {
    if (imported === program.roles.testing || isTestModule(program, imported)) {
      const target = program.modules.get(imported);
      links.diagnostics.push(
        binderDiagnostics.testImport(declaration.path.span, target?.name ?? imported),
      );
    }
  }
}
