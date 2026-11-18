/**
 * What an importer sees of another module by name (§3.13, §10): its export, or, for a test module,
 * its private declaration too, so a test can mock what a module keeps private. A name it doesn't
 * see is reported on the importer's side, as private or as not exported.
 */

import { isTestModule, type ModuleId, type Program } from '../../program/program.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import type { Entity } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import type { ModuleLinks } from './module-links.ts';

/** The program linked and every module's own bindings. */
export interface LinkedModules {
  readonly program: Program;
  readonly locals: ReadonlyMap<ModuleId, ModuleBindings>;
}

/** What the module of `links` sees as `name` of `module`, or a diagnostic saying why nothing. */
export function exportedTo(
  { program, locals }: LinkedModules,
  links: ModuleLinks,
  module: ModuleId,
  name: Identifier,
): Entity | undefined {
  const target = locals.get(module);
  const entity =
    target?.exports.get(name.text) ??
    (isTestModule(program, links.module) ? target?.privates.get(name.text) : undefined);
  if (entity === undefined && target !== undefined) {
    const label = program.modules.get(module)?.tree.source.path ?? module;
    links.diagnostics.push(
      target.privates.has(name.text)
        ? binderDiagnostics.privateExport(name.span, label, name.text)
        : binderDiagnostics.missingExport(name.span, label, name.text),
    );
  }
  return entity;
}
