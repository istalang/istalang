/**
 * Expressions with bodies (§4, §8): `if` chains as values, `match` with field patterns, renames
 * and guards, `select` with and without `await`, its `else` case, and block expressions.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import {
  block,
  bodyOf as body,
  dumpClean,
  expressionStatement,
  ifThen,
  lines,
  named,
  reported,
} from '../parse.test-kit.ts';

const { elseNotLast, expected } = parserDiagnostics;

describe('if', () => {
  it('is a value with one-line branches', () => {
    expect(dumpClean('expression', 'if a: 1 else: 2')).toBe(ifThen('a', body('1'), body('2')));
  });
});

describe('match', () => {
  it('binds, renames, guards and falls back', () => {
    const text = lines(
      'match d:',
      '    case Approved{by}: by',
      '    case Rejected{reason as why} if why != "":',
      '        why',
      '    case _: "x"',
    );
    expect(dumpClean('statement', text)).toBe(
      expressionStatement(
        `(Match d [(MatchCase (StructPattern ${named('Approved')} [(BindFieldPattern by _)]) _ ${body('by')}) (MatchCase (StructPattern ${named('Rejected')} [(BindFieldPattern reason why)]) (Binary why != "") ${body('why')}) (MatchCase (WildcardPattern) _ ${body('"x"')})])`,
      ),
    );
  });

  it('reports a line that is not a case once, and keeps the cases around it', () => {
    const text = lines('match x:', '    foo()', '    case 1: 2');
    expect(reported('statement', text)).toEqual(reportedOnce(expected.code, 'foo'));
  });
});

describe('select', () => {
  const receive = '(Call (MemberAccess box receive) [] [])';

  it('is one node with await when it waits', () => {
    const text = lines(
      'await select:',
      '    case box.receive() as msg: msg',
      '    case time.delay(5d): none',
    );
    expect(dumpClean('statement', text)).toBe(
      expressionStatement(
        `(Select awaits [(SelectCase ${receive} msg ${body('msg')}) (SelectCase (Call (MemberAccess time delay) [] [432000000ms]) _ ${body('none')})] _)`,
      ),
    );
  });

  it('keeps else as its last case', () => {
    const text = lines('select:', '    case box.receive() as msg: msg', '    else: none');
    expect(dumpClean('statement', text)).toBe(
      expressionStatement(
        `(Select [(SelectCase ${receive} msg ${body('msg')})] (ElseClause ${body('none')}))`,
      ),
    );
  });

  it('reports an else before another case once', () => {
    const text = lines('select:', '    else: 1', '    case a: 2');
    expect(reported('statement', text)).toEqual(reportedOnce(elseNotLast.code, 'else: 1'));
  });
});

describe('block expressions', () => {
  it('have statements and a value', () => {
    expect(dumpClean('expression', '{ const t = a * b; t + 1 }')).toBe(
      `(BlockExpression ${block('(VariableDeclaration _ [(NamePattern [t] [])] _ (Binary a * b))', expressionStatement('(Binary t + 1)'))})`,
    );
  });
});
