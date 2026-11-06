/**
 * What an alias or an associated type stands for (§3.1, §3.17): a type, or a type `match`, whose
 * cases follow layout as a `match` expression's do (layout/bodies.ts).
 *
 * - A case's pattern is `_`, a struct constraint at `struct` (never the shape `struct { … }`
 *   spells, which `{ … }` writes in a case), or a type, which may hold `infer` anywhere.
 * - A case's type stands after its `:`, on the same line or indented below, as one body item:
 *   a second type there is reported, since a case gives one type.
 */

import { isUnnamed } from '../../../language/naming.ts';
import type { AliasBody } from '../../syntax/declarations/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { WildcardPattern } from '../../syntax/patterns.ts';
import type { CasePattern, TypeCase, TypeMatch, TypeNode } from '../../syntax/types/index.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { parseBody } from '../layout/bodies.ts';
import type { ItemRules } from '../layout/index.ts';
import type { Parser } from '../parser.ts';
import { parseCase } from '../parts/cases.ts';
import { parseStructConstraint } from '../parts/constraints.ts';

/** The body after an alias's or associated type's `=`: a type `match` at `match`, else a type. */
export function parseAliasBody(parser: Parser): AliasBody {
  return parser.cursor.at('match') ? parseTypeMatch(parser) : parser.type();
}

/** `match D:` and its cases, at `match`. */
function parseTypeMatch(parser: Parser): TypeMatch {
  const { start } = parser.cursor.advance().span;
  const subject = parser.type();
  parser.expect(':');
  const { items: cases } = parseBody(parser, typeCaseRules, start);
  return { kind: 'TypeMatch', span: parser.spanFrom(start), subject, cases };
}

/** `case P: T`. */
function parseTypeCase(parser: Parser): TypeCase | Invalid {
  return parseCase(parser, (start) => {
    const pattern = parseCasePattern(parser);
    parser.expect(':');
    const { items } = parseBody(parser, caseTypeRules, start);
    const [first, ...more] = items;
    const [second] = more;
    if (second !== undefined) {
      parser.report(parserDiagnostics.severalCaseTypes(parser.textSpanOf(second.span)));
    }
    const type: TypeNode = first ?? parser.missing('a type');
    return { kind: 'TypeCase', span: parser.spanFrom(start), pattern, type };
  });
}

/** `_`, a struct constraint at `struct`, or a type. */
function parseCasePattern(parser: Parser): CasePattern {
  const { cursor } = parser;
  if (cursor.at('identifier') && isUnnamed(parser.textOf(cursor.token))) {
    const wildcard: WildcardPattern = {
      kind: 'WildcardPattern',
      span: parser.anchor(cursor.advance().span),
    };
    return wildcard;
  }
  return cursor.at('struct') ? parseStructConstraint(parser) : parser.type();
}

const typeCaseRules: ItemRules<TypeCase> = {
  parseItem: parseTypeCase,
  separator: 'lineBreak',
  annotate: undefined,
};

const caseTypeRules: ItemRules<TypeNode> = {
  parseItem: (parser) => parser.type(),
  separator: 'lineBreak',
  annotate: undefined,
};
