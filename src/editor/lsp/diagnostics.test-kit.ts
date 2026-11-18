/**
 * What `ista check` reports, as a client of the language server receives it, to state what the
 * server must publish: the project loaded as `ista check` loads it, its std trees parsed once per
 * test file, and each checker made afresh.
 */

import { pathToFileURL } from 'node:url';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import { diagnoseModule } from '../../compiler/compile.ts';
import { type Program, programModule } from '../../compiler/program/program.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import type { SourceText } from '../../foundation/text/source-text.ts';
import type { Span } from '../../foundation/text/span.ts';
import { moduleIdOfFile } from '../../project/file-loader.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import { uriOf } from './locations.ts';

/** What `ista check` reports in `file` of `program`, as a client receives it. */
export function checked(program: Program, file: string) {
  const { source, diagnostics } = diagnoseModule(program, moduleIdOfFile(file));
  return diagnostics.map(({ span, severity, code, message, related }) => ({
    range: rangeIn(source, span),
    severity: severity === 'error' ? 1 : 2,
    code,
    source: 'ista',
    message,
    relatedInformation: related.map((each) => ({
      location: {
        uri: uriOf(each.module),
        range: rangeIn(programModule(program, each.module).tree.source, each.span),
      },
      message: each.message,
    })),
  }));
}

/** The lines and characters `span` covers in `source`, as a client counts them. */
function rangeIn(source: SourceText, span: Span) {
  const lines = lineMapOf(source);
  const position = (offset: number) => {
    const { line, column } = lines.positionAt(offset);
    return { line, character: column };
  };
  return { start: position(span.start), end: position(span.end) };
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
export const fileUriOf = (file: string) => pathToFileURL(file).href;
