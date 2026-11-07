/**
 * Templates (§2): their texts and values, tags, values spanning lines, and what a broken value
 * reports without disturbing what follows the template.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../../diagnostics.ts';
import { dumpClean, dumpOf, parseAs, reported } from '../../../parse.test-kit.ts';

describe('templates', () => {
  it.each([
    ['`plain`', '(TemplateLiteral _ [(TemplateText plain)] [])'],
    ['`a ${x} b`', '(TemplateLiteral _ [(TemplateText a ) (TemplateText  b)] [x])'],
    [
      '`${a + b}${f(c)}`',
      '(TemplateLiteral _ [(TemplateText ) (TemplateText ) (TemplateText )] [(Binary a + b) (Call f [c])])',
    ],
    [
      '`${\n  x\n    + y\n}`',
      '(TemplateLiteral _ [(TemplateText ) (TemplateText )] [(Binary x + y)])',
    ],
    [
      '`${`${x}`}`',
      '(TemplateLiteral _ [(TemplateText ) (TemplateText )] [(TemplateLiteral _ [(TemplateText ) (TemplateText )] [x])])',
    ],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['sql`a ${x}`', '(TemplateLiteral sql [(TemplateText a ) (TemplateText )] [x])'],
    ['db.sql`q`', '(TemplateLiteral (MemberAccess db sql) [(TemplateText q)] [])'],
    ['f(x)`q`.size', '(MemberAccess (TemplateLiteral (Call f [x]) [(TemplateText q)] []) size)'],
  ])('takes the expression before it as its tag: %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('binds its tag tighter than any operator', () => {
    expect(dumpClean('expression', 'a + t`q`')).toBe(
      '(Binary a + (TemplateLiteral t [(TemplateText q)] []))',
    );
  });

  it('is no tag across a line break', () => {
    expect(parseAs('statement', 'f()\n`q`').rest).toBeGreaterThan(0);
  });

  it('reports an empty value and keeps parsing after the template', () => {
    expect(reported('expression', '`${}` + 1')).toEqual(
      reportedOnce(parserDiagnostics.emptyTemplateValue.code, '${}'),
    );
    expect(dumpOf(parseAs('expression', '`${}` + 1'))).toBe(
      '(Binary (TemplateLiteral _ [(TemplateText ) (TemplateText )] [?]) + 1)',
    );
  });

  it('reports what follows a value inside its braces, and nothing outside', () => {
    const text = '`${a b c}` + 1';
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
    expect(parseAs('expression', text).diagnostics[0]?.message).toContain("Expected '}'");
    expect(parseAs('expression', text).rest).toBe(0);
  });

  it("says a value ended at its '}', not at the end of the input", () => {
    expect(parseAs('expression', '`${a +}`').diagnostics[0]?.message).toContain("found '}'");
  });
});
