/**
 * The sources a TypeScript file holds, and edits made back into it: an edit lands in exactly one
 * literal's raw text and reads back as made there; an edit crossing literals or touching a
 * substitution is refused, never made.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../edits.ts';
import { type Embedding, fileEditOf } from '../../embedding.ts';
import type { Edit } from '../../pass.ts';
import { spell } from './escapes.ts';
import { embedTypeScript } from './index.ts';

/** A file's sources' texts. */
function textsIn(contents: string): readonly string[] {
  return embedTypeScript('test.ts', contents).embeddings.map(({ text }) => text);
}

/** A file's first source; throws if it holds none. */
function firstSourceOf(contents: string): Embedding {
  const [embedding] = embedTypeScript('test.ts', contents).embeddings;
  if (embedding === undefined) {
    throw new Error('The file holds no source.');
  }
  return embedding;
}

/** Characters with escapes, line breaks, and wide ones, for literal texts. */
const lineText = fc.string({
  unit: fc.constantFrom('a', 'b', ' ', '(', '\\', "'", '"', '`', '$', '{', '‸', '\t'),
});

/** An edit somewhere in a text of `length`, replacing what it covers. */
function editIn(length: number): fc.Arbitrary<Edit> {
  return fc.tuple(fc.nat(length), fc.nat(length), lineText).map(([first, second, text]) => ({
    span: { start: Math.min(first, second), end: Math.max(first, second) },
    text,
  }));
}

/** The file with `edit` made through `embedding`, or undefined where the file refuses it. */
function editedThrough(contents: string, embedding: Embedding, edit: Edit): string | undefined {
  const fileEdit = fileEditOf(embedding, edit);
  return 'refusal' in fileEdit ? undefined : applyEdits(contents, [fileEdit]);
}

/** A comment of wide characters first, so UTF-8 positions and UTF-16 offsets differ. */
const preamble = '// ‸😀 wide\n';

describe('line groups', () => {
  const group = fc.array(lineText, { minLength: 1, maxLength: 5 });

  /** An array literal of `lines` as `'…'` strings, joined as tests join them. */
  function arrayOf(lines: readonly string[]): string {
    return `${preamble}f([${lines.map((line) => `'${spell(line, "'")}'`).join(', ')}].join('\\n'));\n`;
  }

  it('joins every string of an array or argument list into one source', () => {
    expect(textsIn("lines('a', \"b\", `c`);\nf(['x', 'y']);\ng('p', q);")).toEqual([
      'a\nb\nc',
      'x\ny',
      'p',
    ]);
  });

  /** Lines, the index of one, and an edit inside that one, offset into the joined text. */
  const editInOneLine = group.chain((lines) =>
    fc.nat(lines.length - 1).chain((index) => {
      const offset = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
      return editIn(lines[index]?.length ?? 0).map(({ span, text }) => ({
        lines,
        edit: { span: { start: span.start + offset, end: span.end + offset }, text },
      }));
    }),
  );

  it('makes an edit inside one string in that string alone, reading back as made', () => {
    fc.assert(
      fc.property(editInOneLine, ({ lines, edit }) => {
        const contents = arrayOf(lines);
        const embedding = firstSourceOf(contents);
        expect(embedding.text).toBe(lines.join('\n'));
        const edited = editedThrough(contents, embedding, edit);
        expect(edited === undefined ? undefined : textsIn(edited)[0]).toBe(
          applyEdits(lines.join('\n'), [edit]),
        );
      }),
    );
  });

  it('refuses an edit across two strings of a group', () => {
    const embedding = firstSourceOf(arrayOf(['ab', 'cd']));
    expect(embedding.text).toBe('ab\ncd');
    expect(fileEditOf(embedding, { span: { start: 1, end: 4 }, text: '' })).toHaveProperty(
      'refusal',
    );
  });
});

describe('templates', () => {
  const quasis = fc.array(lineText, { minLength: 1, maxLength: 4 });

  /** A template of `parts` with a substitution between each two. */
  function templateOf(parts: readonly string[]): string {
    const spelled = parts.map((part) => spell(part, '`') ?? '');
    return `${preamble}const t = \`${spelled.join('${value}')}\`;\n`;
  }

  it('makes edits only outside substitutions, and reads each back as made', () => {
    fc.assert(
      fc.property(
        quasis.chain((parts) => {
          const contents = templateOf(parts);
          return fc.tuple(fc.constant(contents), editIn(firstSourceOf(contents).text.length));
        }),
        ([contents, edit]) => {
          const embedding = firstSourceOf(contents);
          const fileEdit = fileEditOf(embedding, edit);
          if ('refusal' in fileEdit) {
            return;
          }
          const substitutions = [...contents.matchAll(/\$\{value\}/gu)].map(({ index }) => ({
            start: index,
            end: index + '${value}'.length,
          }));
          for (const substitution of substitutions) {
            expect(
              fileEdit.span.end <= substitution.start || fileEdit.span.start >= substitution.end,
            ).toBe(true);
          }
          const edited = applyEdits(contents, [fileEdit]);
          expect(textsIn(edited)[0]).toBe(applyEdits(embedding.text, [edit]));
        },
      ),
    );
  });

  it('stands a name in for a substitution, which no edit may touch', () => {
    const embedding = firstSourceOf('const t = `defer ${f}(x)`;');
    expect(embedding.text).toBe('defer __substitution__(x)');
    expect(fileEditOf(embedding, { span: { start: 6, end: 8 }, text: '' })).toHaveProperty(
      'refusal',
    );
    expect(fileEditOf(embedding, { span: { start: 6, end: 6 }, text: '(' })).toEqual({
      span: { start: 17, end: 17 },
      text: '(',
    });
  });

  it('reads no tagged template, but the literals in its substitutions', () => {
    expect(textsIn("const t = String.raw`a${'b'}c`;")).toEqual(['b']);
  });
});
