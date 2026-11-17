/**
 * Edits of a module's text, as an editor makes them, for the properties that hold what is built
 * after an edit to what is built afresh (docs/work/done/m6-m7/incremental-checking.md, Acceptance), and
 * the module texts they edit: the corpus programs and the std test modules.
 *
 * Random edits delete or double a line, replace a word or rename it everywhere, append an item, or
 * type a few characters anywhere, line breaks and indentation included, which layout reads. An edit
 * inside one body touches a name in that function's body alone, so everything else stays alike.
 */

import { globSync, readFileSync } from 'node:fs';
import fc from 'fast-check';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { bodyOf, nodesUnder, type SyntaxNode, type SyntaxTree } from '../syntax/tree/index.ts';
import { spanIn } from '../syntax/tree/positions.ts';

/** A module's text, named for a test's title. */
interface ModuleText {
  readonly name: string;
  readonly text: string;
}

/** Every test module of the std library, by its path under src/stdlib. */
export const stdTests: readonly ModuleText[] = globSync('*/*.test.ista', {
  cwd: new URL('../../stdlib/', import.meta.url),
}).map((name) => ({
  name: `std ${name}`,
  text: readFileSync(new URL(`../../stdlib/${name}`, import.meta.url), 'utf8'),
}));

/** The corpus programs, valid and not, and the std test modules. */
export const editedTexts: readonly ModuleText[] = [...runPrograms, ...invalidPrograms, ...stdTests];

/** An edit of a module's text, its positions taken modulo what the text has. */
export type Edit =
  | { readonly kind: 'delete' | 'duplicate'; readonly line: number }
  | { readonly kind: 'replace' | 'rename'; readonly word: number; readonly by: number }
  | { readonly kind: 'append'; readonly item: number }
  | { readonly kind: 'type'; readonly at: number; readonly typed: number };

/** Items an edit appends: a function, a struct, and an enum whose variants others may name bare. */
const appended = [
  'fn appended(x: Int) -> Int: x + 1',
  'struct Appended:\n  a: Int',
  'enum Appended:\n  None\n  Some\n  Red',
];

/** What an edit types: characters that change tokens, brackets, layout and comments. */
const typed = ['x', ' ', '\n', '\n  ', '(', ')', ':', ',', '1 + ', '# c', '"', '\t'];

const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constantFrom('delete', 'duplicate'), line: fc.nat() }),
  fc.record({ kind: fc.constantFrom('replace', 'rename'), word: fc.nat(), by: fc.nat() }),
  fc.record({ kind: fc.constant('append'), item: fc.nat(appended.length - 1) }),
  fc.record({ kind: fc.constant('type'), at: fc.nat(), typed: fc.nat(typed.length - 1) }),
) as fc.Arbitrary<Edit>;

/** One to three edits, made one after another. */
export const editSequences = fc.array(editArbitrary, { minLength: 1, maxLength: 3 });

/** `text` after `edit`. */
export function applied(text: string, edit: Edit): string {
  const lines = text.split('\n');
  const words = [...text.matchAll(/[A-Za-z_]\w*/gu)];
  switch (edit.kind) {
    case 'delete':
    case 'duplicate': {
      const line = edit.line % Math.max(lines.length, 1);
      const kept = edit.kind === 'delete' ? [] : [lines[line] ?? ''];
      return [...lines.slice(0, line), ...kept, ...lines.slice(line)].join('\n');
    }
    case 'replace':
    case 'rename': {
      const word = words[edit.word % Math.max(words.length, 1)];
      const by = words[edit.by % Math.max(words.length, 1)]?.[0] ?? 'x';
      if (word?.index === undefined) {
        return text;
      }
      if (edit.kind === 'rename') {
        return text.replaceAll(new RegExp(`\\b${word[0]}\\b`, 'gu'), `${word[0]}Z`);
      }
      return text.slice(0, word.index) + by + text.slice(word.index + word[0].length);
    }
    case 'append':
      return `${text}\n${appended[edit.item] ?? ''}\n`;
    case 'type': {
      const at = edit.at % (text.length + 1);
      return text.slice(0, at) + (typed[edit.typed] ?? '') + text.slice(at);
    }
    default: {
      const unhandled: never = edit;
      return unhandled;
    }
  }
}

/** An edit inside one function's body: the text after it, and the function edited. */
interface BodyEdit {
  readonly text: string;
  readonly edited: FunctionDeclaration;
}

/**
 * `tree`'s text with a name in the body of one of its top-level functions renamed, the function
 * the `function`-th of those `chosen` accepts and the name the `name`-th in its body, both modulo
 * how many there are; undefined when none has a body with a name in it.
 */
export function editInsideBody(
  tree: SyntaxTree,
  { function: index, name }: { readonly function: number; readonly name: number },
  chosen: (declaration: FunctionDeclaration) => boolean = () => true,
): BodyEdit | undefined {
  const candidates = tree.root.items.flatMap((item) => {
    const body = item.kind === 'FunctionDeclaration' ? bodyOf(tree, item) : undefined;
    const names = body === undefined ? [] : identifiersIn(tree, body);
    return item.kind === 'FunctionDeclaration' && chosen(item) && names.length > 0
      ? [{ edited: item, names }]
      : [];
  });
  const candidate = candidates[index % Math.max(candidates.length, 1)];
  const named = candidate?.names[name % candidate.names.length];
  if (candidate === undefined || named === undefined) {
    return undefined;
  }
  const { end } = spanIn(tree, named.span);
  const { text } = tree.source;
  return { text: `${text.slice(0, end)}Z${text.slice(end)}`, edited: candidate.edited };
}

/** The names written in `node` of `tree`, in source order. */
function identifiersIn(tree: SyntaxTree, node: SyntaxNode): readonly SyntaxNode[] {
  return nodesUnder(tree, node).filter((each) => each.kind === 'Identifier' && each.text !== '');
}

/** Which body edit a property makes: indices into the functions and the names in its body. */
export const bodyEditChoices = fc.record({ function: fc.nat(), name: fc.nat() });
