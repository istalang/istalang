/**
 * A Definition as one JavaScript ES module (docs/work/js-codegen/design.md): live and simple code,
 * run in a browser or Node by the runtime library, which the module imports by `runtime`.
 *
 * - The module default-exports the runtime library's program over its tables (live/program-tables.ts):
 *   constants as literals, built once at load and shared by every run, and its code as a factory
 *   binding the externs, `x<n>`, and the code entries, `f<n>`, to one run.
 * - Ista code stays on the interpreter, and so do the natives reaching instances, contexts, slots
 *   or tests (stdlib/natives.ts): a Definition holding either is refused, naming it.
 * - Emitting is one pass over the IR, cheap beside checking and lowering, so nothing is cached.
 */

import { type Definition, definitionFormat } from '../definition/definition.ts';
import { contentHash } from '../definition/formats/codec.ts';
import { bodyStart, type CodeFunction } from '../definition/tables/functions.ts';
import type { CodeShape, ExternShape } from '../live/program-tables.ts';
import { helpers } from '../live/values/helpers.ts';
import { interpreterNativeKeys } from '../stdlib/natives.ts';
import { emitCodeEntry } from './code-entry.ts';
import { EntryScope, type ProgramScope } from './entry-scope.ts';
import { literal } from './literal.ts';

export interface EmitOptions {
  /** The module specifier the program imports the runtime library by: `istalang/live`. */
  readonly runtime: string;
  /**
   * Whether every write of a register the entry doesn't count checks that what it writes reaches
   * nothing counted: tests hold lowering's `counted` to what runs (definition/tables/functions.ts).
   */
  readonly checksCounted?: boolean;
}

/** A program's module text, or why it can't run as JavaScript. */
export type Emitted =
  | { readonly kind: 'emitted'; readonly text: string }
  | { readonly kind: 'refused'; readonly problem: string };

/** `definition` as an ES module. */
export function emitProgram(definition: Definition, options: EmitOptions): Emitted {
  const problem = definition.functions.map(interpreterOnly).find((each) => each !== undefined);
  return problem === undefined
    ? { kind: 'emitted', text: moduleText(definition, options) }
    : { kind: 'refused', problem };
}

/** Why `entry` runs on the interpreter alone: it is ista code, or a native only it has. */
function interpreterOnly(entry: Definition['functions'][number]): string | undefined {
  if (entry.kind === 'code') {
    return entry.mode === 'ista'
      ? `${entry.name} is ista code, which runs on the interpreter (ista run)`
      : undefined;
  }
  return interpreterNativeKeys.has(entry.key)
    ? `${entry.key} reaches what only the interpreter has (ista run)`
    : undefined;
}

function moduleText(definition: Definition, options: EmitOptions): string {
  const { functions } = definition;
  const program: ProgramScope = {
    functionName: (index) => (functions[index]?.kind === 'code' ? `f${index}` : `x${index}`),
    checksCounted: options.checksCounted === true,
  };
  const lines = [
    `import { program } from ${JSON.stringify(options.runtime)};`,
    // Line 2, so the runtime reads where this module's lines appear on a stack (live/traces.ts).
    'const site = new Error();',
    `const C = ${literal(definition.constants)};`,
    'export default program({',
    `code: (run, { ${Object.keys(helpers).join(', ')} }) => {`,
    'const lt = run.lifetimes;',
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
