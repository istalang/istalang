/**
 * Spec §12.3 (broadcast with expiry) as a hand-written Definition, with `time.delay` written in
 * the M2.4 subset (`at(Time{value: now().value + d.value})`).
 *
 * It exercises what the subset fixture doesn't:
 * - an async function that awaits
 * - extern calls with host types and type arguments
 * - a loop over an array, reading its `length` and each element by `index`
 * - `fn _` holdings that survive their iteration (`keep`), released only when `announce` returns,
 *   which is what retracts the unread copies
 *
 * Its `Revertible` stands in for the real one: an extern type the runtime disposes, whose values
 * are `resource` objects, which is all the snapshot tests need of it. The compiler makes the inbox
 * module's `Revertible<T>` a handle (spec §3.18) holding the host's revertible send instead, which
 * src/runtime/boundary/host-resources.test.ts runs.
 */

import type { Definition } from '../../src/definition/definition.ts';
import {
  externFunction,
  functionCallee,
  int,
  named,
  noSpan,
  sourceModule,
  spanOf,
  string,
  unit,
  valueArgument as v,
} from './fixture-kit.ts';

const broadcastSource = `import * as time from 'time'
import Revertible from 'inbox'

struct Announcement:
  text: string

extern sendable struct Queue<T is Sendable>
extern fn sendRevertible<T is Sendable>(self: Queue<T>, msg: T) -> Revertible<T>
extern fn announcements(user: string) -> Queue<Announcement>

async fn announce(text: string, users: Array<string>, visibleFor: Duration):
  for user in users:
    fn _ = announcements(user).sendRevertible(Announcement{text: text})
  await time.delay(visibleFor)
`;

const at = (snippet: string) => spanOf(broadcastSource, snippet);

const [main, prelude, time] = [0, 1, 2];

/** Indexes into the type table, for tests that build values of these types. */
export const broadcastTypes = {
  announcement: 0,
  stringArray: 1,
  queue: 2,
  revertible: 3,
  duration: 4,
  time: 5,
  futureUnit: 6,
} as const;

const { announcement, stringArray, queue, revertible, time: timeType, futureUnit } = broadcastTypes;

/** Indexes into the function table. */
export const broadcastFunctions = {
  announcements: 0,
  sendRevertible: 1,
  length: 2,
  index: 3,
  compare: 4,
  add: 5,
  now: 6,
  at: 7,
  delay: 8,
  announce: 9,
} as const;

const { announcements, sendRevertible, length, index, compare, add, now, delay } =
  broadcastFunctions;
const timeAt = broadcastFunctions.at;
const [zero, one] = [0, 1];

const loop = at('for user in users');
const send = at('announcements(user).sendRevertible(Announcement{text: text})');

export const broadcastDefinition: Definition = {
  modules: [
    sourceModule('main', broadcastSource),
    sourceModule('prelude'),
    sourceModule('time'),
    sourceModule('inbox'),
  ],
  types: [
    {
      kind: 'struct',
      name: 'main.Announcement',
      arguments: [],
      fields: [{ name: 'text', type: string, annotations: [] }],
    },
    {
      kind: 'extern',
      name: 'prelude.Array',
      arguments: [string],
      sendable: true,
      disposal: { kind: 'none' },
    },
    {
      kind: 'extern',
      name: 'main.Queue',
      arguments: [named(announcement)],
      sendable: true,
      disposal: { kind: 'none' },
    },
    {
      kind: 'extern',
      name: 'inbox.Revertible',
      arguments: [named(announcement)],
      sendable: false,
      disposal: { kind: 'runtime' },
    },
    {
      kind: 'struct',
      name: 'time.Duration',
      arguments: [],
      fields: [{ name: 'value', type: int, annotations: [] }],
    },
    {
      kind: 'struct',
      name: 'time.Time',
      arguments: [],
      fields: [{ name: 'value', type: int, annotations: [] }],
    },
    {
      kind: 'extern',
      name: 'prelude.Future',
      arguments: [unit],
      sendable: false,
      disposal: { kind: 'runtime' },
      role: 'future',
    },
  ],
  constants: [0n, 1n],
  starts: [],
  functions: [
    externFunction({
      module: main,
      key: 'main.announcements(string)',
      parameters: [string],
      result: named(queue),
    }),
    externFunction({
      module: main,
      key: 'main.sendRevertible(Queue<T>, T)',
      parameters: [named(queue), named(announcement)],
      result: named(revertible),
      typeArguments: [named(announcement)],
    }),
    externFunction({
      module: prelude,
      key: 'prelude.length(Array<T>)',
      parameters: [named(stringArray)],
      result: int,
      typeArguments: [string],
    }),
    externFunction({
      module: prelude,
      key: 'prelude.index(Array<T>, int)',
      parameters: [named(stringArray), int],
      result: string,
      typeArguments: [string],
    }),
    externFunction({
      module: prelude,
      key: 'prelude.compare(int, int)',
      parameters: [int, int],
      result: int,
    }),
    externFunction({
      module: prelude,
      key: 'prelude.add(int, int)',
      parameters: [int, int],
      result: int,
    }),
    externFunction({ module: time, key: 'time.now()', parameters: [], result: named(timeType) }),
    externFunction({
      module: time,
      key: 'time.at(Time)',
      parameters: [named(timeType)],
      result: named(futureUnit),
    }),
    {
      kind: 'code',
      name: 'time.delay',
      module: time,
      span: noSpan,
      async: false,
      parameters: [{ reference: false }],
      captures: 0,
      annotations: [],
      registers: 7,
      cells: [],
      instructions: [
        { kind: 'call', span: noSpan, dst: 1, callee: functionCallee(now), arguments: [] },
        { kind: 'field', span: noSpan, dst: 2, src: 1, index: 0 },
        { kind: 'field', span: noSpan, dst: 3, src: 0, index: 0 },
        {
          kind: 'call',
          span: noSpan,
          dst: 4,
          callee: functionCallee(add),
          arguments: [v(2), v(3)],
        },
        { kind: 'struct', span: noSpan, dst: 5, type: timeType, fields: [4] },
        { kind: 'call', span: noSpan, dst: 6, callee: functionCallee(timeAt), arguments: [v(5)] },
        { kind: 'return', span: noSpan, value: 6 },
      ],
    },
    {
      kind: 'code',
      name: 'main.announce',
      module: main,
      span: at('async fn announce(text: string, users: Array<string>, visibleFor: Duration)'),
      async: true,
      parameters: [{ reference: false }, { reference: false }, { reference: false }],
      captures: 0,
      annotations: [],
      registers: 15,
      cells: [],
      instructions: [
        { kind: 'move', span: loop, dst: 3, src: 1 },
        { kind: 'call', span: loop, dst: 4, callee: functionCallee(length), arguments: [v(3)] },
        { kind: 'constant', span: loop, dst: 5, constant: zero },
        {
          kind: 'call',
          span: loop,
          dst: 6,
          callee: functionCallee(compare),
          arguments: [v(5), v(4)],
        },
        { kind: 'order', span: loop, dst: 7, comparison: 6, relation: 'less' },
        { kind: 'branch', span: loop, condition: 7, whenTrue: 6, whenFalse: 15 },
        {
          kind: 'call',
          span: loop,
          dst: 8,
          callee: functionCallee(index),
          arguments: [v(3), v(5)],
        },
        {
          kind: 'call',
          span: at('announcements(user)'),
          dst: 9,
          callee: functionCallee(announcements),
          arguments: [v(8)],
        },
        {
          kind: 'struct',
          span: at('Announcement{text: text}'),
          dst: 10,
          type: announcement,
          fields: [0],
        },
        {
          kind: 'call',
          span: send,
          dst: 11,
          callee: functionCallee(sendRevertible),
          arguments: [v(9), v(10)],
        },
        { kind: 'keep', span: at('fn _ ='), registers: [11] },
        { kind: 'release', span: send, registers: [8, 9, 10, 11] },
        { kind: 'constant', span: loop, dst: 12, constant: one },
        {
          kind: 'call',
          span: loop,
          dst: 5,
          callee: functionCallee(add),
          arguments: [v(5), v(12)],
        },
        { kind: 'jump', span: loop, target: 3 },
        { kind: 'release', span: loop, registers: [3, 4, 5] },
        {
          kind: 'call',
          span: at('time.delay(visibleFor)'),
          dst: 13,
          callee: functionCallee(delay),
          arguments: [v(2)],
        },
        { kind: 'await', span: at('await time.delay(visibleFor)'), dst: 14, future: 13 },
        { kind: 'release', span: at('await time.delay(visibleFor)'), registers: [13] },
        { kind: 'return', span: at('await time.delay(visibleFor)'), value: 14 },
      ],
    },
  ],
};

/** Where `announce` stops: the pc of its `await`, for snapshot tests. */
export const broadcastAwaitPc = 17;
