/**
 * Completion scenarios RB of docs/work/completion/ (resilience), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'RB-01',
    place: 'grammar',
    title: 'Empty function body at the end of the file',
    src: ['fn g(a: Int):\n  ‸'],
    where: 'top',
    expect: { has: ['a', 'plus'] },
  },
  {
    id: 'RB-02',
    place: 'grammar',
    title: 'Empty block in the middle',
    src: [
      '  if n:\n    ‸\n  0',
      '  for i in xs:\n    ‸\n  0',
      '  match d:\n    case Approved(by):\n      ‸\n    case _: 0',
    ],
    expect: { has: ['xs', 'n'] },
  },
  {
    id: 'RB-02b',
    place: 'grammar',
    title: 'Bindings in a freshly opened block',
    src: ['  for i in xs:\n    ‸\n  0', '  if r is Ok(y):\n    ‸\n  0'],
    expect: { anyOf: ['i', 'y'] },
  },
  {
    id: 'RB-03',
    place: 'member',
    title: 'Trailing dot with code below',
    src: ['  p.‸\n  let y = 1\n  y', '  xs.‸\n  return 1'],
    trigger: '.',
    expect: { has: [], lacks: ['let', 'xs'], nonEmpty: true },
  },
  {
    id: 'RB-04',
    place: 'literalField',
    title: 'Unclosed literal with code below',
    src: ['  Pair{first: 1, ‸\n  return 1'],
    trigger: ',',
    expect: { has: ['second'], lacks: ['xs'] },
  },
  {
    id: 'RB-04b',
    place: 'callArgument',
    title: 'Unclosed call with code below',
    src: ['  plus(1, ‸\n  return 1'],
    trigger: ',',
    expect: { has: ['b:'] },
  },
  {
    id: 'RB-05',
    place: 'member',
    title: 'Errors elsewhere',
    src: [
      'fn broken(:\n  1\n\nfn g(xs: Array<Int>) -> Int:\n  xs.‸\n  0',
      'fn broken() -> Int:\n  let = \n  1\nfn g(p: Pair) -> Int:\n  p.‸\n  0',
    ],
    trigger: '.',
    where: 'top',
    expect: { nonEmpty: true },
  },
  {
    id: 'RB-06',
    place: 'member',
    title: 'A type error in the same function',
    src: ['  const bad: String = 1\n  p.‸'],
    trigger: '.',
    expect: { has: ['first'] },
  },
  {
    id: 'RB-07',
    place: 'grammar',
    title: 'Empty file',
    src: ['‸'],
    where: 'empty',
    expect: { has: ['fn', 'struct'], lacks: ['let', 'while'] },
  },
  {
    id: 'RB-08',
    place: 'member',
    title: 'Non-BMP characters before the cursor',
    src: ['  const s = "😀"; p.‸'],
    trigger: '.',
    expect: { has: ['first'] },
  },
  {
    id: 'RB-09',
    place: 'member',
    title: 'CRLF line endings',
    src: ['  p.‸\n  0'],
    trigger: '.',
    crlf: true,
    expect: { has: ['first'] },
  },
];

describeScenarios('completion scenarios RB', scenarios);
