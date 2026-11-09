/**
 * Parenthesized import lists and import renames (proposal 5 §7, note 11): 'import (a, b, c as see)
 * from "./lib"' as a bracketed list following §6's line-break rule, bare 'import a, b from "x"'
 * staying on one line, 'name as alias' binding rules and clash checks, and formatter round-trips
 * (keeping one-line bare or parenthesized as written, and breaking long bare imports into
 * parentheses).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatText } from '../../../../formatter/format.ts';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { binderDiagnostics } from '../../../binder/diagnostics.ts';
import { reported as checkReported } from '../../../checker/check.test-kit.ts';
import { dumpClean, lines, parseAs, reported } from '../../parse.test-kit.ts';

describe('parenthesized import lists (§3.13, §6, §7)', () => {
  it.each([
    [
      'parenthesized names separated by line breaks without commas',
      lines('import (', '  approve', '  Verdict', '  chargeCard', ") from 'purchase/approve'"),
      "import (approve, Verdict, chargeCard) from 'purchase/approve'",
    ],
    [
      'parenthesized names with trailing commas, mixed commas and line breaks, comments and blank lines',
      lines(
        'import (',
        '  # first group',
        '  approve, Verdict',
        '',
        '  # second group',
        '  chargeCard,',
        ") from 'purchase/approve'",
      ),
      "import (approve, Verdict, chargeCard) from 'purchase/approve'",
    ],
    [
      'single parenthesized name across lines',
      lines('import (', '  approve', ") from 'purchase/approve'"),
      "import (approve) from 'purchase/approve'",
    ],
  ])('parses %s to the same tree as on one line', (_name, multiLine, oneLine) => {
    const dumpMulti = dumpClean('module', multiLine);
    expect(dumpMulti.startsWith('NOT CLEAN:')).toBe(false);
    expect(dumpMulti).toBe(dumpClean('module', oneLine));
  });

  it('gives the same tree when any comma in a generated parenthesized import is replaced with a line break', () => {
    const namesArb = fc.uniqueArray(
      fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'Verdict', 'Config'),
      { minLength: 2, maxLength: 6 },
    );
    fc.assert(
      fc.property(
        namesArb,
        fc.array(fc.constantFrom(', ', '\n  ', ',\n  ', '\n  # comment\n  '), {
          minLength: 5,
          maxLength: 5,
        }),
        (names, joins) => {
          const oneLine = `import (${names.join(', ')}) from 'pkg/mod'`;
          const broken = `import (\n  ${names
            .map((name, index) =>
              index === 0 ? name : `${joins[(index - 1) % joins.length]}${name}`,
            )
            .join('')}\n) from 'pkg/mod'`;
          expect(dumpClean('module', broken)).toBe(dumpClean('module', oneLine));
        },
      ),
      { numRuns: 50 },
    );
  });

  it.each([
    [
      'bare import broken across lines after comma',
      lines('import approve,', "  Verdict from 'purchase/approve'"),
    ],
    [
      'bare import broken across lines without comma',
      lines('import approve', "  Verdict from 'purchase/approve'"),
    ],
    [
      'bare import broken before from',
      lines('import approve, Verdict', "  from 'purchase/approve'"),
    ],
    [
      'semicolon between parenthesized import names',
      "import (approve; Verdict) from 'purchase/approve'",
    ],
    ['unclosed parenthesized import list', "import (approve, Verdict from 'purchase/approve'"],
  ])('rejects %s', (_name, text) => {
    expect(reported('module', text).codes.length).toBeGreaterThan(0);
  });

  it('recovers the module path when a parenthesized import list is still being typed', () => {
    const parsed = parseAs('module', lines('import (', '  approve,', ") from 'time'"));
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('formatting parenthesized and bare imports (§7)', () => {
  it('keeps short bare and short parenthesized imports as written on one line, and breaks a long bare import into parentheses', () => {
    const shortBare = "import approve, Verdict from 'purchase/approve'\n";
    expect(formatText(shortBare)).toBe(shortBare);

    const shortParens = "import (approve, Verdict) from 'purchase/approve'\n";
    expect(formatText(shortParens)).toBe(shortParens);

    const longBare =
      "import approvePurchaseRequest, rejectPurchaseRequest, cancelPurchaseRequest, notifyPurchaseReviewers, ChargeVerdict from 'purchase/approval/workflow'\n";
    const formatted = formatText(longBare) ?? '';
    expect(formatted).toBe(
      lines(
        'import (',
        '  approvePurchaseRequest',
        '  rejectPurchaseRequest',
        '  cancelPurchaseRequest',
        '  notifyPurchaseReviewers',
        '  ChargeVerdict',
        ") from 'purchase/approval/workflow'",
        '',
      ),
    );
    expect(formatText(formatted)).toBe(formatted);
  });
});

describe('import renames ("c as see") in bare and parenthesized imports (§7)', () => {
  it.each([
    ['bare one-line import with "as" rename', "import a, b, c as see from './lib'"],
    ['parenthesized one-line import with "as" rename', "import (a, b, c as see) from './lib'"],
    [
      'parenthesized multi-line import with "as" rename and no commas',
      lines('import (', '  a', '  b', '  c as see', ") from './lib'"),
    ],
    [
      'parenthesized multi-line import where "as see" continues the item across a line break (§6)',
      lines('import (', '  a', '  c', '    as see', ") from './lib'"),
    ],
  ])('parses %s without diagnostics and preserves its tree across formatting', (_name, text) => {
    const tree = dumpClean('module', text);
    expect(tree.startsWith('NOT CLEAN:')).toBe(false);
    const formatted = formatText(text) ?? '';
    expect(dumpClean('module', formatted)).toBe(tree);
    expect(formatText(formatted)).toBe(formatted);
  });

  it('binds only the alias in scope, allows importing one export under two names, and checks clashes on bound names', async () => {
    const decls = lines(
      'import (',
      '  Duration as Span',
      '  Duration',
      '  delay as waitFor',
      ") from 'time'",
      'fn makeSpan() -> Span: Span{value: 500}',
    );
    expect(await mainGives('Int', 'makeSpan().value + Duration{value: 100}.value', decls)).toBe(
      600,
    );

    expect(
      checkReported(lines("import Duration as Span from 'time'", 'fn f(d: Duration): ()')).codes,
    ).toContain(binderDiagnostics.undeclared.code);

    expect(
      checkReported(lines("import Duration as Span, Time as Span from 'time'", 'fn f(): ()')).codes,
    ).toContain(binderDiagnostics.duplicateImport.code);

    expect(
      checkReported(lines("import Duration as Array from 'time'", 'fn f(): ()')).codes,
    ).toContain(binderDiagnostics.preludeClash.code);
  });
});
