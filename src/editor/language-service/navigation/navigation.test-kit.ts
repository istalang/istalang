/**
 * Programs of in-memory modules beside the std modules, with their names found as written, so a
 * navigation test says where it asks, and what it expects, by the text it reads. Navigating reads
 * every module, so each program's checker takes over the std modules' results, checked once.
 */

import { stdProgramOf } from '../../../compiler/binder/bind.test-kit.ts';
import { checkedAfterStd } from '../../../compiler/compile.test-kit.ts';
import { idOf } from '../../../compiler/program/program.test-kit.ts';
import { type ModuleId, type Program, programModule } from '../../../compiler/program/program.ts';
import { nodesUnder } from '../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../compiler/syntax/tree/node.ts';
import type { NamePlace } from './declarations.ts';
import { spanOfUse } from './declarations.ts';
import type { NameEdit } from './rename.ts';

/**
 * A program of `files`, keyed by import path, and its names, the `nth` written as `text` in `key`;
 * its checker is made after the std modules' (`checkedAfterStd`).
 */
export function navigable(files: Readonly<Record<string, string>>) {
  const program = stdProgramOf(files);
  checkedAfterStd(program);
  const named = (key: string, text: string, nth = 0): NamePlace => {
    const module = idOf(key);
    const { tree } = programModule(program, module);
    const found = nodesUnder(tree, tree.root).filter(
      (node): node is Identifier => node.kind === 'Identifier' && node.text === text,
    )[nth];
    if (found === undefined) {
      throw new Error(`No name '${text}' number ${nth} in ${key}.`);
    }
    return { module, name: found };
  };
  return { program, named };
}

/** Where `use` of `program` stands, as `key:offset` with `key` the module's import path. */
export function placeOf(program: Program, use: NamePlace): string {
  return `${keyOf(use.module)}:${spanOfUse(program, use).start}`;
}

/** Each module's text with `edits` made, by the module's import path. */
export function edited(
  program: Program,
  edits: readonly NameEdit[],
): Readonly<Record<string, string>> {
  const modules = new Set(edits.map(({ module }) => module));
  return Object.fromEntries(
    [...modules].map((module) => {
      const { text } = programModule(program, module).tree.source;
      const spelled = edits
        .filter((edit) => edit.module === module)
        .toSorted((first, second) => second.span.start - first.span.start)
        .reduce(
          (written, { span, text: replacement }) =>
            written.slice(0, span.start) + replacement + written.slice(span.end),
          text,
        );
      return [keyOf(module), spelled];
    }),
  );
}

function keyOf(module: ModuleId): string {
  return decodeURIComponent(new URL(module).pathname);
}
