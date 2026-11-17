/**
 * Completion scenarios PA of docs/work/done/completion/ (patterns), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'PA-01',
    place: 'pattern',
    title: 'Start of a case pattern',
    src: ['  match d:\n    case ‸', '  match d:\n    case Approved(by): 1\n    case ‸'],
    expect: {
      has: ['Approved', 'Rejected', 'Expired', '_'],
      lacks: ['xs', 'p', 'plus', 'let', 'if', 'Red', 'and'],
    },
  },
  {
    id: 'PA-02',
    place: 'pattern',
    title: 'Variants already covered come last',
    src: ['  match d:\n    case Approved(by): 1\n    case ‸'],
    expect: {
      before: [
        ['Rejected', 'Approved'],
        ['Expired', 'Approved'],
      ],
    },
  },
  {
    id: 'PA-03',
    place: 'patternField',
    title: "Braces after a variant's name in a pattern",
    src: [
      '  match d:\n    case Rejected{‸',
      '  match d:\n    case Rejected{reason as why, ‸}',
      '  if r is Ok{‸',
    ],
    trigger: '{',
    expect: { lacks: ['by', 'reason', 'value'] },
  },
  {
    id: 'PA-03c',
    place: 'pattern',
    title: 'Field labels in a call pattern',
    src: ['  match d:\n    case Rejected(‸', '  match d:\n    case Rejected("legal", ‸'],
    expect: {
      has: ['reason:', '_'],
      lacks: ['xs', 'plus', 'let'],
      insert: [['reason:', 'reason: ']],
    },
  },
  {
    id: 'PA-03c',
    place: 'pattern',
    title: 'Field labels in a call pattern after a named one',
    src: ['  match d:\n    case Rejected(reason: "r", ‸'],
    expect: { exact: ['by:'] },
  },
  {
    id: 'PA-04',
    place: 'pattern',
    title: 'After a pattern field',
    src: ['  match cfg:\n    case Cfg{note ‸'],
    expect: { has: ['as', 'is'], lacks: ['xs', 'plus'] },
  },
  {
    id: 'PA-05',
    place: 'declaredName',
    title: 'After as in a pattern',
    src: ['  match cfg:\n    case Cfg{note as ‸'],
    expect: { none: true },
  },
  {
    id: 'PA-06',
    place: 'pattern',
    title: 'After is in a pattern',
    src: ['  match cfg:\n    case Cfg{note is ‸'],
    expect: { has: ['_'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'PA-06b',
    place: 'grammar',
    title: 'After == in a pattern',
    src: ['  match cfg:\n    case Cfg{note == ‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let'] },
  },
  {
    id: 'PA-07',
    place: 'pattern',
    title: 'is outside match',
    src: ['  if r is ‸'],
    expect: { has: ['_', 'Ok', 'Err'], lacks: ['xs', 'let', 'plus'] },
  },
  {
    id: 'PA-07b',
    place: 'pattern',
    title: 'is on an optional',
    src: ['  const k = o is ‸'],
    expect: { has: ['_', 'Int', 'None', 'none'], lacks: ['xs', 'let', 'plus', 'true'] },
  },
  {
    id: 'PA-08',
    place: 'pattern',
    title: 'Field labels of Ok in is',
    src: ['  if r is Ok(‸'],
    expect: { has: ['value:', '_'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'PA-08b',
    place: 'patternField',
    title: "Fields of an optional's member in is",
    src: ['  if po is Pair{‸', '  match po:\n    case Pair{‸'],
    trigger: '{',
    expect: { has: ['first', 'second'], lacks: ['xs', 'plus'] },
  },
  {
    id: 'PA-09',
    place: 'pattern',
    title: 'Alternatives and nesting',
    src: ['  match d:\n    case Approved(by) | ‸', '  match cfg:\n    case Cfg{note is ‸'],
    expect: { lacks: ['xs', 'let', 'plus'] },
  },
  {
    id: 'PA-10',
    place: 'member',
    title: 'Qualified variants in a pattern',
    src: ['  match d:\n    case Decision.‸', '  match col:\n    case Color.‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs'], anyOf: ['Expired', 'Red'] },
  },
  {
    id: 'PA-11',
    place: 'pattern',
    title: 'Literals, tuples, arrays, ranges',
    src: [
      '  match n:\n    case ‸',
      '  match n:\n    case 0..=‸',
      '  match xs:\n    case [first, ...‸',
    ],
    expect: { lacks: ['xs', 'let', 'plus'] },
  },
  {
    id: 'PA-12',
    place: 'grammar',
    title: 'Guard',
    src: ['  match d:\n    case Approved(by) if ‸', '  match n:\n    case x if ‸'],
    expect: { has: ['xs'], lacks: ['let'] },
  },
  {
    id: 'PA-13',
    place: 'grammar',
    title: 'Arm of a match after :',
    src: ['  match d:\n    case Expired: ‸'],
    expect: { has: ['xs'], lacks: ['enum', 'trait', 'import', 'extern', 'case'] },
  },
];

describeScenarios('completion scenarios PA', scenarios);
