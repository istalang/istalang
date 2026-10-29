/**
 * The module behind a namespace import, `import json`: the one its importing module's import map
 * names (program.ts), which is what a qualified name through it reads.
 */

import type { NamespaceEntity } from '../compiler/binder/entities.ts';
import type { Checker } from '../compiler/checker/check.ts';
import type { ProgramModule } from '../compiler/program/program.ts';

/** The module `namespace` imports; undefined when its import named none. */
export function importedModule(
  { bindings, program }: Checker,
  namespace: NamespaceEntity,
): ProgramModule | undefined {
  const importer = bindings.moduleOf(namespace);
  const imported = importer && program.modules.get(importer)?.imports.get(namespace.declaration);
  return imported && program.modules.get(imported);
}
