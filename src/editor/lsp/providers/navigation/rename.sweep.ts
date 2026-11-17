/**
 * Renaming through the server across the corpus: a rename keeps every diagnostic and every renamed
 * name denoting what it did.
 *
 * It runs in slices, one per `rename-<n>.sweep.test.ts` beside this module (test/slices.ts), each
 * with a server of its own: every name of the computed programs is dealt round them, and so are
 * the two sampled properties.
 */

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PrepareRenameRequest,
  RenameRequest,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import { corpusDirectory } from '../../../../../test/corpus/programs.ts';
import { sliceOf } from '../../../../../test/slices.ts';
import { checkProgram } from '../../../../compiler/checker/check.ts';
import { diagnoseModule } from '../../../../compiler/compile.ts';
import {
  isStdModule,
  type ModuleId,
  type Program,
  programModule,
} from '../../../../compiler/program/program.ts';
import { parentOf } from '../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { isError } from '../../../../foundation/diagnostics/diagnostic.ts';
import { collectionFunctions } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { lineMapOf } from '../../../../foundation/text/line-map.ts';
import type { NamePlace } from '../../../language-service/navigation/declarations.ts';
import {
  isSamePlace,
  nameAt,
  spelledName,
} from '../../../language-service/navigation/declarations.ts';
import { namesDenoting } from '../../../language-service/navigation/references.ts';
import { renamingAt } from '../../../language-service/navigation/rename.ts';
import { corpusClient, corpusProgram } from '../../corpus-client.test-kit.ts';
import { moduleIdOfUri, rangeOf } from '../../locations.ts';
import { projectProgramLoader } from '../../project-loader.ts';
import type { TestClient } from '../../server.test-kit.ts';
import { namesOf, positionOf } from './navigation.test-kit.ts';

/**
 * The names keyed reads spell (§3.9), by module: `d.city` denotes the `index` it calls alone, so
 * renaming the field its key names leaves the read behind. TODO(F36): rename reaches keyed reads.
 */
const keyedReadNames = new Set(
  [...corpusProgram.modules].flatMap(([module, { tree }]) =>
    isStdModule(corpusProgram, module)
      ? []
      : namesOf(tree).flatMap((name) => {
          const at = nameAt(corpusProgram, module, spanIn(tree, name.span).start);
          const callsIndex = at?.declarations.some(
            ({ declared }) =>
              declared.kind === 'function' &&
              declared.declaration.name.text === collectionFunctions.index &&
              spelledName(name) !== collectionFunctions.index,
          );
          return callsIndex === true ? [`${module} ${spelledName(name)}`] : [];
        }),
  ),
);

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
        const declares = renaming?.kind === 'renamable' && isSamePlace(renaming.target.at, use);
        return declares && !keyedReadNames.has(`${module} ${spelledName(name)}`) ? [use] : [];
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

const diagnosticsBefore = diagnosticsOf(corpusProgram, (message) => message);

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
async function renamingProblems(
  client: TestClient,
  declaring: NamePlace,
): Promise<readonly string[]> {
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
  // Checked as the language server checks an edit: after the corpus, re-checking what it changed.
  checkProgram(renamed, { previous: corpusProgram });
  const after = diagnosticsOf(renamed, (message) => message.replaceAll(newName, old));
  const declaringNow = moved.get(`${declaring.module} ${declaringAt.start}`);
  return [
    ...(writtenNames.has(newName) ? [`${newName} is written already`] : []),
    ...(JSON.stringify(prepared) === JSON.stringify(expected) ? [] : ['prepared another range']),
    ...diagnosticsBefore.filter((each) => !after.includes(each)).map((each) => `lost: ${each}`),
    ...after.filter((each) => !diagnosticsBefore.includes(each)).map((each) => `gained: ${each}`),
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

/** A sampled property: renaming `numRuns` of `names` keeps what each meant. */
interface Sampled {
  readonly name: string;
  readonly names: () => readonly NamePlace[];
  readonly numRuns: number;
}

/** The sampled properties, each one slice's. */
const sampled: readonly Sampled[] = [
  {
    name: 'keeps every diagnostic, and every renamed name denoting what it did',
    names: () => renamable,
    numRuns: 40,
  },
  {
    name: 'spells shorthands out, keeping what they mean',
    names: () => renamable.filter(hasShorthand),
    numRuns: 20,
  },
];

/** A slice's longest wait: every rename re-diagnoses the whole corpus, a tenth of a second each. */
const sliceTimeout = 240_000;

/** Registers the sampled property as a test, each rename sent to the server `client()` answers with. */
function sampledTest({ name, names, numRuns }: Sampled, client: () => TestClient): void {
  it(name, { timeout: sliceTimeout }, async () => {
    const sample = names();
    expect(sample.length).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...sample), async (declaring) => {
        expect(await renamingProblems(client(), declaring)).toEqual([]);
      }),
      { numRuns },
    );
  });
}

/** Registers the renames of the slice `file` (its `import.meta.url`), against a server of its own. */
export function renameSlice(file: string): void {
  const slice = sliceOf(file);
  let client: TestClient;

  beforeAll(async () => {
    client = await corpusClient();
  });

  const server = () => client;

  describe('renaming across the corpus', () => {
    for (const property of slice.of(sampled)) {
      sampledTest(property, server);
    }

    it('keeps what a program of computed types means, renaming each name it may', {
      timeout: sliceTimeout,
    }, async () => {
      const keyed = slice.of(renamable.filter(({ module }) => module.includes('/computed/')));
      expect(keyed.length).toBeGreaterThan(0);
      const problems = await Promise.all(keyed.map((each) => renamingProblems(client, each)));
      expect(problems.flat()).toEqual([]);
      // Every name of every computed program, not a sample, dealt round the slices.
    });
  });
}
