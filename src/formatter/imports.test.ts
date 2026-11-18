/**
 * The import block (imports.ts): every import hoisted, one statement per path, sorted by path, its
 * items `*`, each `* as m`, then the names filling lines; checked on examples and over generated
 * modules, which keep what they bind and format once and for all.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lines, parseText, roundTripOf } from './format.test-kit.ts';
import { formatText } from './format.ts';

describe('the import block', () => {
  it('hoists the imports, sorted by path: root ones, then ../ from the farthest, then ./', () => {
    const text = lines(
      "import a from './b'",
      'fn f(): 1',
      "import a from './a'",
      "import x from '../near'",
      "import y from '../../far'",
      "import z from 'zeta'",
      "import t from 'Time'",
    );
    expect(formatText(text)).toBe(
      lines(
        "import t from 'Time'",
        "import z from 'zeta'",
        "import y from '../../far'",
        "import x from '../near'",
        "import a from './a'",
        "import a from './b'",
        '',
        'fn f(): 1',
      ),
    );
  });

  it('merges the imports of a path: *, each * as m by m, then the names, on one line when they fit', () => {
    const text = lines(
      "import encode, Decoder as D from 'json'",
      "import * as j from 'json'",
      "import * from 'json'",
      "import * as a from 'json'",
    );
    expect(formatText(text)).toBe(
      lines("import *, * as a, * as j, Decoder as D, encode from 'json'"),
    );
  });

  it('puts each star on a line of its own once the import breaks, the names filling the lines after', () => {
    const [first, second] = ['firstNamespaceAlias', 'secondNamespaceAlias'];
    const text = lines(
      `import (*, * as ${second}, * as ${first}, decodeAll, encodeAll) from 'module/path'`,
    );
    expect(formatText(text)).toBe(
      lines(
        'import (',
        '  *',
        `  * as ${first}`,
        `  * as ${second}`,
        '  decodeAll, encodeAll',
        ") from 'module/path'",
      ),
    );
  });

  it('keeps one star alone on one line, and names bare while they fit', () => {
    const text = lines(
      "import * as json from 'json'",
      "import * from 'time'",
      "import b, a from 'x'",
    );
    expect(formatText(text)).toBe(
      lines("import * from 'time'", "import * as json from 'json'", "import a, b from 'x'"),
    );
  });

  it('puts statements on one line before broken ones among paths of one kind, stars or not', () => {
    const names = ['firstExportedName', 'secondExportedName', 'thirdExportedName', 'thirdOfThem'];
    const text = lines(
      `import ${names.join(', ')}, fifthExportedName from 'a'`,
      "import * from 'b'",
      "import c from 'c'",
    );
    expect(formatText(text)).toBe(
      lines(
        "import * from 'b'",
        "import c from 'c'",
        'import (',
        `  fifthExportedName, ${names.slice(0, 2).join(', ')}`,
        `  ${names.slice(2).join(', ')}`,
        ") from 'a'",
      ),
    );
  });

  it('puts statements with *, then with * as m, first among paths of one kind', () => {
    const text = lines(
      "import a from './a'",
      "import * as m from './m'",
      "import * from './z'",
      "import b from 'b'",
      "import * as c from 'c'",
      "import (*, d) from 'd'",
      "import e from '../e'",
      "import * as f from '../f'",
    );
    expect(formatText(text)).toBe(
      lines(
        "import *, d from 'd'",
        "import * as c from 'c'",
        "import b from 'b'",
        "import * as f from '../f'",
        "import e from '../e'",
        "import * from './z'",
        "import * as m from './m'",
        "import a from './a'",
      ),
    );
  });

  it('packs names past the width into lines within 66 columns, alphabetically regardless of case', () => {
    const names = Array.from({ length: 14 }, (_, index) => `name${String(index).padStart(2, '0')}`);
    const formatted = formatText(lines(`import Zed, ${names.join(', ')} from 'module/path'`)) ?? '';
    expect(formatted.split('\n')).toEqual([
      'import (',
      `  ${names.slice(0, 8).join(', ')}`,
      `  ${names.slice(8).join(', ')}, Zed`,
      ") from 'module/path'",
      '',
    ]);
  });

  it('keeps each comment by its import or name, and a module header at the top', () => {
    const text = lines(
      '# header',
      '',
      "import b from './x'  # why b",
      '# about a',
      "import a from 'lib'",
      "import c from './x'  # why c",
      'import (',
      '  e  # why e',
      '  d',
      ") from 'lib'",
    );
    const { actual, expected, formatted } = roundTripOf(text);
    expect(actual).toEqual(expected);
    expect(formatted).toBe(
      lines(
        '# header',
        '',
        'import (',
        '  # about a',
        '  a',
        '  d',
        '  e # why e',
        ") from 'lib'",
        'import (',
        '  b # why b',
        '  c # why c',
        ") from './x'",
      ),
    );
  });

  it('keeps a header lying against a declaration at the top, above the imports hoisted', () => {
    const text = lines('# outcome: 1', '# what it shows', 'fn f(): 1', "import * as m from 'm'");
    expect(formatText(text)).toBe(
      lines('# outcome: 1', '# what it shows', "import * as m from 'm'", '', 'fn f(): 1'),
    );
  });

  it('leaves an annotated import alone, its annotation on it only', () => {
    const plain = lines('@foo', "import a from 'x'", "import b from 'x'");
    // The annotated import takes two lines, so it sorts after the one on one line.
    expect(formatText(plain)).toBe(lines("import b from 'x'", '@foo', "import a from 'x'"));
    const commented = lines('@foo', "import a from 'x'", "import b from 'x' # bee");
    const { actual, expected, formatted } = roundTripOf(commented);
    expect(actual).toEqual(expected);
    expect(formatted).toContain('@foo\nimport a from');
  });

  const paths = ['lib', 'a/b', '../up', '../../far', './near', './Near'];
  const items = ['*', '* as ns', '* as other', 'one', 'two as deux', 'Three', 'four'];
  const comment = (text: string) => fc.constantFrom('', text);
  const statement = fc
    .record({
      path: fc.constantFrom(...paths),
      items: fc.uniqueArray(fc.constantFrom(...items), { minLength: 1, maxLength: 4 }),
      parenthesized: fc.boolean(),
      leading: comment('# leading\n'),
      annotation: fc.constantFrom('', '@foo\n'),
      opening: comment(' # opening'),
      first: comment(' # first'),
      trailing: comment('  # trailing'),
    })
    .map(
      ({
        path,
        items: [head, ...tail],
        parenthesized,
        leading,
        annotation,
        opening,
        first,
        trailing,
      }) =>
        parenthesized
          ? `${leading}${annotation}import (${opening}\n  ${[`${head}${first}`, ...tail].join('\n  ')}\n) from '${path}'${trailing}`
          : `${leading}${annotation}import ${[head, ...tail].join(', ')} from '${path}'${trailing}`,
    );

  it('keeps what generated imports bind, their comments and annotations, one statement per path but for annotated ones, formatting once and for all', () => {
    fc.assert(
      fc.property(fc.array(statement, { minLength: 1, maxLength: 8 }), (statements) => {
        const text = lines(...statements, 'fn f(): 1');
        const { actual, expected, reparsed } = roundTripOf(text);
        expect(actual).toEqual(expected);
        // An annotated import stands alone; every other path has one statement.
        const written = reparsed.root.items.flatMap((item) =>
          item.kind === 'ImportDeclaration' &&
          item.path.kind === 'StringLiteral' &&
          (item.annotations ?? []).length === 0
            ? [item.path.value]
            : [],
        );
        expect(written).toEqual([...new Set(written)]);
        expect(parseText(statements.join('\n')).diagnostics).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
