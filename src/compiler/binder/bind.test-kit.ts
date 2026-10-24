/**
 * Programs bound with the real prelude, and what tests observe of them: the binder's diagnostics
 * per module, and which declaration a name resolves to.
 *
 * A resolution is asserted as "the n-th `x` in this module resolves to the m-th `x`", identifiers
 * found by their text in source order, so a test reads as its source and needs no offsets.
 */

import { type Reported, reportedIn } from '../../diagnostics/diagnostic.test-kit.ts';
import { preludeModule, stdlibLoader, timeModule } from '../../stdlib/stdlib-loader.ts';
import type { Files } from '../program/program.test-kit.ts';
import { idOf, moduleAt, programOf } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import type { Identifier } from '../syntax/node.ts';
import { descendants } from '../syntax/tree.test-kit.ts';
import { bindProgram } from './bind.ts';
import type { Entity } from './entities.ts';

/** The program rooted at the first of `files`, with the prelude. */
export function preludeProgramOf(files: Files, previous?: Program): Program {
  return programOf(files, { previous, prelude: preludeModule() });
}

/** The program rooted at the first of `files` as an app loads it: with every std module. */
export function stdProgramOf(files: Files, previous?: Program): Program {
  return programOf(files, {
    previous,
    prelude: preludeModule(),
    time: timeModule(),
    loaders: [stdlibLoader()],
  });
}

/** What the binder reported in module `key` (default: the first file). */
export function boundReport(files: Files, key = Object.keys(files)[0] ?? ''): Reported {
  const program = preludeProgramOf(files);
  return reportedIn(
    moduleAt(program, key).tree.source,
    bindProgram(program).diagnosticsOf(idOf(key)),
  );
}

/** The identifiers spelled `text` in module `key`, in source order. */
export function namesIn(program: Program, key: string, text: string): readonly Identifier[] {
  return descendants(moduleAt(program, key).tree.root).filter(
    (node): node is Identifier => node.kind === 'Identifier' && node.text === text,
  );
}

/** What the `index`-th `text` of module `key` denotes. */
export function entityOfName(
  program: Program,
  key: string,
  text: string,
  index: number,
): Entity | undefined {
  const name = namesIn(program, key, text)[index];
  return name === undefined ? undefined : bindProgram(program).entityOf(idOf(key), name);
}

/** The name an entity was declared with; undefined for a primitive or a set of candidates. */
export function declaringName(entity: Entity | undefined): Identifier | undefined {
  switch (entity?.kind) {
    case 'variable':
      return entity.name;
    case 'functions':
      return entity.overloads[0]?.name;
    case 'type':
      return entity.declaration.name;
    case 'variant':
      return entity.variant.name;
    case 'self':
      return entity.trait.name;
    case 'namespace':
      return entity.declaration.alias;
    default:
      return;
  }
}
