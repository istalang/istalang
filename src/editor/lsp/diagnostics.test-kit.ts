/**
 * What `ista check` reports, as a client of the language server receives it, to state what the
 * server must publish: the project loaded as `ista check` loads it, its std trees parsed once per
 * test file, and each checker made afresh.
 */

import { pathToFileURL } from 'node:url';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import { diagnoseModule } from '../../compiler/compile.ts';
import type { Program } from '../../compiler/program/program.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { moduleIdOfFile } from '../../project/file-loader.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';

/** What `ista check` reports in `file` of `program`, as a client receives it. */
export function checked(program: Program, file: string) {
  const { source, diagnostics } = diagnoseModule(program, moduleIdOfFile(file));
  const lines = lineMapOf(source);
  const position = (offset: number) => {
    const { line, column } = lines.positionAt(offset);
    return { line, character: column };
  };
  return diagnostics.map(({ span, severity, code, message }) => ({
    range: { start: position(span.start), end: position(span.end) },
    severity: severity === 'error' ? 1 : 2,
    code,
    source: 'ista',
    message,
  }));
}

/** The std modules every program loads, parsed once for every project loaded after. */
const stdLoaded = loadProject(corpusDirectory, []).program;

/**
 * The program `ista check` makes of the project at `root`: its std trees are parsed alike whenever
 * loaded, so they are taken from `stdLoaded`; its checker is made afresh.
 */
export function projectProgram(root: string): Program {
  return loadProject(root, findProjectSources(root), { previous: stdLoaded }).program;
}

/** The URI a client opens `file` under. */
export const uriOf = (file: string) => pathToFileURL(file).href;
