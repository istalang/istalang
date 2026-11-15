/**
 * A Definition as one JavaScript ES module (docs/work/js-codegen/design.md): live and simple code,
 * run in a browser or Node by the runtime library, which the module imports by `runtime`.
 *
 * - The module default-exports the runtime library's program over its tables (live/program-tables.ts):
 *   constants as literals, built once at load and shared by every run, and its code as a factory
 *   binding the externs, `x<n>`, and the code entries, `f<n>`, to one run.
 * - Ista code stays on the interpreter, so a Definition holding any is refused, naming it.
 * - Emitting is one pass over the IR, cheap beside checking and lowering, so nothing is cached.
 */

import { type Definition, definitionFormat } from '../definition/definition.ts';
import { contentHash } from '../definition/formats/codec.ts';
import { bodyStart, type CodeFunction } from '../definition/tables/functions.ts';
import type { CodeShape, ExternShape } from '../live/program-tables.ts';
import { helpers } from '../live/values/helpers.ts';
import { emitCodeEntry } from './code-entry.ts';
import { EntryScope, type ProgramScope } from './entry-scope.ts';
import { literal } from './literal.ts';

export interface EmitOptions {
  /** The module specifier the program imports the runtime library by: `istalang/live`. */
  readonly runtime: string;
}

/** A program's module text, or why it can't run as JavaScript. */
export type Emitted =
  | { readonly kind: 'emitted'; readonly text: string }
  | { readonly kind: 'refused'; readonly problem: string };

/** `definition` as an ES module. */
export function emitProgram(definition: Definition, options: EmitOptions): Emitted {
  const ista = definition.functions.find((entry) => entry.kind === 'code' && entry.mode === 'ista');
  if (ista !== undefined) {
    return {
      kind: 'refused',
      problem: `${ista.name} is ista code, which runs on the interpreter (ista run)`,
    };
  }
  return { kind: 'emitted', text: moduleText(definition, options) };
}

function moduleText(definition: Definition, options: EmitOptions): string {
  const { functions } = definition;
  const program: ProgramScope = {
    functionName: (index) => (functions[index]?.kind === 'code' ? `f${index}` : `x${index}`),
  };
  const lines = [
    `import { program } from ${JSON.stringify(options.runtime)};`,
    // Line 2, so the runtime reads where this module's lines appear on a stack (live/traces.ts).
    'const site = new Error();',
    `const C = ${literal(definition.constants)};`,
    'export default program({',
    `code: (run, { ${Object.keys(helpers).join(', ')} }) => {`,
  ];
  const shapes: (CodeShape | ExternShape)[] = [];
  for (const [index, entry] of functions.entries()) {
    if (entry.kind === 'extern') {
      lines.push(`const x${index} = run.extern(${index});`);
      shapes[index] = entry;
    }
  }
  for (const [index, entry] of functions.entries()) {
    if (entry.kind === 'code') {
      const emitted = emitCodeEntry(new EntryScope(index, entry, program));
      shapes[index] = codeShape(entry, lines.length + emitted.firstInstruction + 1);
      lines.push(...emitted.lines);
    }
  }
  lines.push(
    `const F = [${functions.map((_, index) => program.functionName(index)).join(', ')}];`,
    'return F;',
    '},',
    `functions: ${literal(shapes)},`,
    `types: ${literal(definition.types)},`,
    `modules: ${literal(definition.modules)},`,
    `starts: ${literal(definition.starts)},`,
    `main: ${literal(definition.main)},`,
    `version: ${literal(contentHash(definitionFormat.write(definition).text))},`,
    'constants: C,',
    'site,',
    '});',
  );
  return `${lines.join('\n')}\n`;
}

/** What a run keeps of `entry`, whose first instruction is on module line `line`. */
function codeShape(entry: CodeFunction, line: number): CodeShape {
  return {
    kind: 'code',
    name: entry.name,
    module: entry.module,
    parameters: entry.parameters,
    line,
    spans: entry.instructions.map((instruction) => instruction.span.start),
    start: entry.span.start,
    body: bodyStart(entry),
  };
}
