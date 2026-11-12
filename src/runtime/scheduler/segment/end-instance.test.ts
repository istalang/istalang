/**
 * Terminating a panicked instance (§3.12) disposes what it holds (§7), on programs the real
 * compiler builds: its root stops, so a call it held is disposed as any released call is, its
 * `disposing()` case running before it stops.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import type { HostExterns } from '../../boundary/host-natives.ts';
import { runToEnd, testRuntime } from '../../runtime.test-kit.ts';

const program = compiledText(
  [
    'extern fn note(text: String)',
    'extern fn ready() -> Bool',
    '',
    'ista async fn child() -> Int:',
    '  await select:',
    '    case child.disposing():',
    '      note("child cleaned up")',
    '      0',
    '    case time.delay(1d):',
    '      1',
    '',
    "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
    '  const running = child()',
    '  await time.delay(1s)',
    '  if not ready():',
    '    panic("refused")',
    '  await running',
  ].join('\n'),
);

describe('terminating an instance', () => {
  it("runs the cleanup of a call its root held, as that call's disposal", async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
      'main.ready()': () => false,
    };
    const test = testRuntime({ host });
    const started = test.startInstance(program, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked' });
    expect(notes).toEqual([]);
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['child cleaned up']);
  });

  it("runs the cleanup of a call held by a panicked context's invocation when the context is terminated (§3.12, §7, §9)", async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
    };
    const test = testRuntime({ host });
    const deployed = test.runtime.deploy(
      compiledText(
        [
          'extern fn note(text: String)',
          '',
          'ista async fn child() -> Int:',
          '  await select:',
          '    case child.disposing():',
          '      note("child cleaned up")',
          '      0',
          '    case time.delay(1d):',
          '      1',
          '',
          "import * as runtime from 'runtime'\nimport * as time from 'time'",
          'live async fn main() -> Int: await runtime.run("t") _main()',
          'ista async fn _main() -> Int:',
          '  const running = child()',
          '  await runtime.commit()',
          '  panic("refused")',
          '  await running',
        ].join('\n'),
      ),
    );
    expect((await deployed.start('run')).state).toMatchObject({
      kind: 'panicked',
      message: 'refused',
    });
    expect(test.runtime.inspect('t').state).toMatchObject({ kind: 'panicked' });
    expect(notes).toEqual([]);
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['child cleaned up']);
  });

  it('lets go of a disposal that panics before its call runs, the rest going on', async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
    };
    const test = testRuntime({ host });
    const dropping = compiledText(
      [
        'extern fn note(text: String)',
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'struct Dropper:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Dropper, done: Resolver<Int, "ista">): ()',
        'struct Panicking:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Panicking, done: Resolver<Int, "ista">) -> Unit: panic("in onAwait")',
        'shared struct Probe { name: String }',
        'ista fn dispose(self: Probe):',
        '  const got = select:',
        '    case Dropper: 1',
        '    else: 0',
        '  note("probed " + self->name)',
        'shared struct CrashProbe { name: String }',
        'ista fn dispose(self: CrashProbe):',
        '  const got = select:',
        '    case Panicking: 1',
        '    else: 0',
        '  note("crashed " + self->name)',
        'shared struct Lease { name: String }',
        'fn dispose(self: Lease): note("disposed " + self->name)',
        'ista async fn boom():',
        '  await time.delay(5ms)',
        '  panic("boom")',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  const crash = new CrashProbe{name: "crash"}',
        '  const lease = new Lease{name: "lease"}',
        '  const probe = new Probe{name: "probe"}',
        '  hold _ = boom()',
        '  await time.delay(1d)',
        '  0',
      ].join('\n'),
    );
    const started = test.startInstance(dropping, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked', message: 'boom' });
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['disposed lease']);
  });

  it.each([
    ['before', ['disposed lease']],
    ['after', ['disposed lease']],
  ])(
    'withdraws the wait a disposal abandoned mid-way opened, a lease made %s it still disposed',
    async (order, expected) => {
      const notes: unknown[] = [];
      const host: HostExterns = {
        'main.note(String)': ([text]) => {
          notes.push(text);
          return null;
        },
      };
      const test = testRuntime({ host });
      const lease = '  const lease = new Lease{name: "lease"}';
      const crash = '  const crash = new CrashProbe{name: "crash"}';
      const abandoning = compiledText(
        [
          'extern fn note(text: String)',
          "import * as time from 'time'\nimport * as runtime from 'runtime'",
          'struct Panicking:',
          '  type Mode = "ista"',
          'ista fn onAwait(self: Panicking, done: Resolver<Int, "ista">) -> Unit: panic("in onAwait")',
          'shared struct CrashProbe { name: String }',
          'ista fn dispose(self: CrashProbe):',
          '  const got = select:',
          '    case Panicking: 1',
          '    else: 0',
          '  note("crashed " + self->name)',
          'shared struct Lease { name: String }',
          'fn dispose(self: Lease): note("disposed " + self->name)',
          'ista async fn boom():',
          '  await time.delay(5ms)',
          '  panic("boom")',
          'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> Int:',
          ...(order === 'before' ? [lease, crash] : [crash, lease]),
          '  hold _ = boom()',
          '  await time.delay(1d)',
          '  0',
        ].join('\n'),
      );
      const started = test.startInstance(abandoning, 't');
      expect(await runToEnd(test, 't', started)).toMatchObject({
        kind: 'panicked',
        message: 'boom',
      });
      expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
      expect(notes).toEqual(expected);
    },
  );

  it('disposes what a case of a wait a disposal abandoned mid-way awaited', async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
    };
    const test = testRuntime({ host });
    const awaiting = compiledText(
      [
        'extern fn note(text: String)',
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        "import * as futures from 'futures'",
        'struct Panicking:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Panicking, done: Resolver<Int, "ista">) -> Unit: panic("in onAwait")',
        'shared struct Lease { name: String }',
        'fn dispose(self: Lease): note("disposed " + self->name)',
        'shared struct CrashProbe { s: Slot<Lease> }',
        'ista fn dispose(self: CrashProbe):',
        '  const got = select:',
        '    case futures.first([self->s.put(new Lease{name: "in-put"})]): 1',
        '    case Panicking: 2',
        '    else: 0',
        '  note("crashed")',
        'ista async fn boom():',
        '  await time.delay(5ms)',
        '  panic("boom")',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  const s = Slot.create<Lease>()',
        '  _ = s.put(new Lease{name: "in-slot"})',
        '  const crash = new CrashProbe{s}',
        '  hold _ = boom()',
        '  await time.delay(1d)',
        '  0',
      ].join('\n'),
    );
    const started = test.startInstance(awaiting, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked', message: 'boom' });
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes.map(String).toSorted((first, second) => first.localeCompare(second))).toEqual([
      'disposed in-put',
      'disposed in-slot',
    ]);
  });

  it.each(['frame', 'field', 'fieldAfterLocalDispose'] as const)(
    'keeps an outer disposal running when an inner abandoned disposal lets go of an unregistered resolver (%s)',
    async (where) => {
      const notes: unknown[] = [];
      const host: HostExterns = {
        'main.note(String)': ([text]) => {
          notes.push(text);
          return null;
        },
      };
      const test = testRuntime({ host });
      const innerDeclaration =
        where === 'frame'
          ? [
              'shared struct Inner { box: Shared<Resolver<Int, "ista">?> }',
              'ista fn dispose(self: Inner) -> Unit: { const r = self->box->value; self->box->value = none; panic("inner panic") }',
            ]
          : [
              'shared struct Child { name: String }',
              'fn dispose(self: Child): note("disposed " + self->name)',
              'shared struct Inner { r: Resolver<Int, "ista">? }',
              'ista fn dispose(self: Inner) -> Unit:',
              ...(where === 'fieldAfterLocalDispose' ? ['  const c = new Child{name: "c"}'] : []),
              '  panic("inner panic")',
            ];
      const dropInner =
        where === 'frame'
          ? ['  drop new Inner{box: self.box}']
          : ['  if true: { const inner = new Inner{r: self.box->value}; self.box->value = none }'];
      const nested = compiledText(
        [
          'extern fn note(text: String)',
          "import * as time from 'time'\nimport * as runtime from 'runtime'",
          ...innerDeclaration,
          'struct SaveDone { box: Shared<Resolver<Int, "ista">?>, type Mode = "ista" }',
          'ista fn onAwait(self: SaveDone, done: Resolver<Int, "ista">): self.box->value = done',
          'struct DropInner { box: Shared<Resolver<Int, "ista">?>, type Mode = "ista" }',
          'ista fn onAwait(self: DropInner, done: Resolver<Int, "ista">):',
          ...dropInner,
          '  done.resolve(2)',
          'shared struct Outer { name: String }',
          'ista fn dispose(self: Outer):',
          '  const box = new Shared<Resolver<Int, "ista">?>{value: none}',
          '  const got = select:',
          '    case SaveDone{box}: 1',
          '    case DropInner{box}: 2',
          '    else: 0',
          '  note("outer survived " + got)',
          'ista async fn boom(): { await time.delay(5ms); panic("boom") }',
          'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> Int: { const outer = new Outer{name: "outer"}; hold _ = boom(); await time.delay(1d); 0 }',
        ].join('\n'),
      );
      const started = test.startInstance(nested, 't');
      expect(await runToEnd(test, 't', started)).toMatchObject({
        kind: 'panicked',
        message: 'boom',
      });
      expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
      expect(notes).toEqual(
        where === 'fieldAfterLocalDispose'
          ? ['disposed c', 'outer survived 2']
          : ['outer survived 2'],
      );
    },
  );

  it.each(['terminate', 'blockExit'] as const)(
    'does not panic or abandon a disposal that releases a resolver whose waiter already lost its last holder (%s)',
    async (mode) => {
      const notes: unknown[] = [];
      const host: HostExterns = {
        'main.note(String)': ([text]) => {
          notes.push(text);
          return null;
        },
      };
      const test = testRuntime({ host });
      const bodies = {
        terminate: [
          '  const box = new Shared<Resolver<Int, "ista">?>{value: none}',
          '  const waiting = waiter(box); const cleaner = new Cleaner{box}',
          '  hold _ = boom(); await time.delay(1d); await waiting',
        ],
        blockExit: [
          '  if true: { const box = new Shared<Resolver<Int, "ista">?>{value: none}; const _ = waiter(box); const cleaner = new Cleaner{box} }',
          '  0',
        ],
      } as const;
      const programText = compiledText(
        [
          'extern fn note(text: String)',
          "import * as time from 'time'\nimport * as runtime from 'runtime'",
          'struct SaveDone { box: Shared<Resolver<Int, "ista">?>, type Mode = "ista" }',
          'ista fn onAwait(self: SaveDone, done: Resolver<Int, "ista">): self.box->value = done',
          'ista async fn waiter(box: Shared<Resolver<Int, "ista">?>) -> Int: await SaveDone{box}',
          'shared struct Cleaner { box: Shared<Resolver<Int, "ista">?> }',
          'ista fn dispose(self: Cleaner): { self->box->value = none; note("cleaned up") }',
          'ista async fn boom(): { await time.delay(5ms); panic("boom") }',
          'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> Int:',
          ...bodies[mode],
        ].join('\n'),
      );
      const started = test.startInstance(programText, 't');
      const ran = await runToEnd(test, 't', started);
      const ended = mode === 'terminate' ? (await test.runtime.terminate('t')).state : ran;
      expect(ended).toMatchObject({ kind: mode === 'terminate' ? 'terminated' : 'finished' });
      expect(notes).toEqual(['cleaned up']);
    },
  );

  it.each([
    ['clears the resolver in its dispose, while it still holds the call', true],
    ['leaves the resolver to go with its fields, the call with it', false],
  ])(
    'panics only while a call its holder still holds waits, when that holder %s',
    async (_case, clears) => {
      const taskProgram = compiledText(
        [
          'struct SaveDone { box: Shared<Resolver<Int, "ista">?>, type Mode = "ista" }',
          'ista fn onAwait(self: SaveDone, done: Resolver<Int, "ista">): self.box->value = done',
          'ista async fn waiter(box: Shared<Resolver<Int, "ista">?>) -> Int: await SaveDone{box}',
          'shared struct Task { box: Shared<Resolver<Int, "ista">?>, running: Future<Int, "ista"> }',
          `ista fn dispose(self: Task): ${clears ? 'self->box->value = none' : '()'}`,
          "import * as runtime from 'runtime'",
          'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
          'ista async fn _main() -> Int:',
          '  if true: { const box = new Shared<Resolver<Int, "ista">?>{value: none}; const task = new Task{box, running: waiter(box)} }',
          '  0',
        ].join('\n'),
      );
      const test = testRuntime();
      const ran = await runToEnd(test, 't', test.startInstance(taskProgram, 't'));
      expect(ran).toMatchObject(
        clears
          ? {
              kind: 'panicked',
              message: expect.stringContaining('let go of unresolved'),
              trace: expect.stringContaining('main.dispose'),
            }
          : { kind: 'finished' },
      );
    },
  );
});
