/**
 * Renaming through the server across the corpus: a rename keeps every diagnostic and every renamed
 * name denoting what it did.
 */

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PrepareRenameRequest,
  RenameRequest,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import { corpusDirectory } from '../../../../test/corpus/programs.ts';
import { diagnoseModule } from '../../../compiler/compile.ts';
import {
  isStdModule,
  type ModuleId,
  type Program,
  programModule,
} from '../../../compiler/program/program.ts';
import { parentOf } from '../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { isError } from '../../../diagnostics/diagnostic.ts';
import type { NamePlace } from '../../../language-service/navigation/declarations.ts';
import {
  isSamePlace,
  nameAt,
  spelledName,
} from '../../../language-service/navigation/declarations.ts';
import { namesDenoting } from '../../../language-service/navigation/references.ts';
import { renamingAt } from '../../../language-service/navigation/rename.ts';
import { lineMapOf } from '../../../text/line-map.ts';
import { corpusClient, corpusProgram } from '../../corpus-client.test-kit.ts';
import { moduleIdOfUri, rangeOf } from '../../locations.ts';
import { projectProgramLoader } from '../../project-loader.ts';
import type { TestClient } from '../../server.test-kit.ts';
import { namesOf, positionOf } from './navigation.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

/**
 * Every name of the corpus project's modules that check clean and declares what it may rename. In
 * a module with errors, a name meant for a declaration may not resolve to it, so renaming the
 * declaration leaves it, and its diagnostic, behind.
 */
const renamable: readonly NamePlace[] = [...corpusProgram.modules].flatMap(([module, { tree }]) =>
  isStdModule(corpusProgram, module) ||
  diagnoseModule(corpusProgram, module).diagnostics.some(isError)
    ? []
    : namesOf(tree).flatMap((name) => {
        const renaming = renamingAt(corpusProgram, module, spanIn(tree, name.span).start);
        const use = { module, name };
        return renaming?.kind === 'renamable' && isSamePlace(renaming.target.at, use) ? [use] : [];
      }),
);

/**
 * Whether a name denoting what `declaring` declares is a shorthand, naming a field and a variable.
 */
function hasShorthand(declaring: NamePlace): boolean {
  return namesDenoting(corpusProgram, declaring).some(({ module, name }) => {
    const holder = parentOf(programModule(corpusProgram, module).tree, name);
    return (
      (holder?.kind === 'FieldInitializer' && holder.value === undefined) ||
      (holder?.kind === 'BindFieldPattern' && holder.alias === undefined)
    );
  });
}

const writtenNames = new Set(
  [...corpusProgram.modules.values()].flatMap(({ tree }) => namesOf(tree).map(spelledName)),
);

/**
 * A program's diagnostics, each as its module, line, code and message, the names in it as `spell`
 * spells them.
 */
function diagnosticsOf(program: Program, spell: (message: string) => string): readonly string[] {
  return [...program.modules.keys()].flatMap((module) => {
    const { source, diagnostics } = diagnoseModule(program, module);
    const lines = lineMapOf(source);
    return diagnostics.map(
      ({ span, severity, code, message }) =>
        `${module}:${lines.positionAt(span.start).line} ${severity} ${code} ${spell(message)}`,
    );
  });
}

/** Each edited module's new text, and where each name it renamed starts in it. */
function applied(edit: WorkspaceEdit, newName: string) {
  const texts = new Map<ModuleId, string>();
  const moved = new Map<string, number>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const module = moduleIdOfUri(uri);
    const { source } = programModule(corpusProgram, module).tree;
    const lines = lineMapOf(source);
    const offsets = edits
      .map(({ range, newText }) => ({
        start: lines.offsetAt({ line: range.start.line, column: range.start.character }),
        end: lines.offsetAt({ line: range.end.line, column: range.end.character }),
        newText,
      }))
      .toSorted((first, second) => first.start - second.start);
    let text = '';
    let read = 0;
    for (const { start, end, newText } of offsets) {
      text += source.text.slice(read, start);
      const renamedAt = newText.startsWith(newName) ? 0 : newText.length - newName.length;
      moved.set(`${module} ${start}`, text.length + renamedAt);
      text += newText;
      read = end;
    }
    texts.set(module, text + source.text.slice(read));
  }
  return { texts, moved };
}

/**
 * What goes wrong renaming `declaring` through the server: its range or placeholder misread, a
 * diagnostic changed, or a renamed name no longer denoting it. Nothing, when the program means what
 * it meant.
 */
async function renamingProblems(declaring: NamePlace): Promise<readonly string[]> {
  const uri = declaring.module;
  const { tree } = programModule(corpusProgram, declaring.module);
  const { source } = tree;
  const declaringAt = spanIn(tree, declaring.name.span);
  const position = positionOf(source, declaringAt.start);
  const old = spelledName(declaring.name);
  const newName = `${old}Renamed`;
  const prepared = await client.connection.sendRequest(PrepareRenameRequest.type, {
    textDocument: { uri },
    position,
  });
  const expected = { range: rangeOf(source, declaringAt), placeholder: old };
  const edit = await client.connection.sendRequest(RenameRequest.type, {
    textDocument: { uri },
    position,
    newName,
  });
  const { texts, moved } = applied(edit ?? {}, newName);
  const renamed = projectProgramLoader(corpusDirectory)(texts, corpusProgram);
  const before = diagnosticsOf(corpusProgram, (message) => message);
  const after = diagnosticsOf(renamed, (message) => message.replaceAll(newName, old));
  const declaringNow = moved.get(`${declaring.module} ${declaringAt.start}`);
  return [
    ...(writtenNames.has(newName) ? [`${newName} is written already`] : []),
    ...(JSON.stringify(prepared) === JSON.stringify(expected) ? [] : ['prepared another range']),
    ...before.filter((each) => !after.includes(each)).map((each) => `lost: ${each}`),
    ...after.filter((each) => !before.includes(each)).map((each) => `gained: ${each}`),
    ...[...moved].flatMap(([place, offset]) => {
      const module = place.slice(0, place.lastIndexOf(' ')) as ModuleId;
      const denoted = nameAt(renamed, module, offset)?.declarations ?? [];
      const still = denoted.some(
        ({ at }) =>
          at.module === declaring.module &&
          spanIn(programModule(renamed, at.module).tree, at.name.span).start === declaringNow,
      );
      return still ? [] : [`${place} no longer denotes it`];
    }),
  ];
}

describe('renaming across the corpus', () => {
  it('keeps every diagnostic, and every renamed name denoting what it did', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...renamable), async (declaring) => {
        expect(await renamingProblems(declaring)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('keeps what a program of computed types means, renaming each name it may', async () => {
    const keyed = renamable.filter(({ module }) => module.includes('/computed/'));
    expect(keyed.length).toBeGreaterThan(0);
    const problems = await Promise.all(keyed.map(renamingProblems));
    expect(problems.flat()).toEqual([]);
  }, 120_000);

  it('spells shorthands out, keeping what they mean', async () => {
    const shorthands = renamable.filter(hasShorthand);
    expect(shorthands.length).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...shorthands), async (declaring) => {
        expect(await renamingProblems(declaring)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});
