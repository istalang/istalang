/**
 * Scheduler speed, measured with `npm run bench` and kept out of `npm run verify`, as the parser's
 * is (parse.bench.ts).
 *
 * - The first workload is the one the scheduler's costs were filed against (docs/work/tracker.md,
 *   the scheduler's commit cost): many executions waiting on one inbox, each woken by a job of its
 *   own, with `main` awaiting every result, so every result is a commit of a heap that holds every
 *   waiting worker.
 * - The second lets go of a disposable on every turn of a loop, beside many held ones: what
 *   collecting costs per release, which counting keeps from growing with what is held
 *   (docs/work/static-lifetimes/design.md §9).
 * - The third wakes a live run many times beside many held objects: what letting go of what nothing
 *   holds costs per segment, which walking only once the heap has doubled keeps from growing with
 *   what is held (design.md §9.5).
 *
 * A run takes seconds, so a few runs are measured.
 */

import { test as it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { noHeapCheck } from './loaded-definition.ts';

const workers = 400;

const text = compiledText(`
import Inbox from 'inbox'
import * as runtime from 'runtime'

ista async fn worker(jobs: Inbox<Int>, results: Inbox<Int>):
  const job = await jobs.receive()
  results.send(job)

live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int:
  const jobs = Inbox.create<Int>()
  const results = Inbox.create<Int>()
  let running: Array<Future<Unit, "ista">> = []
  let started = 0
  while started < ${workers}:
    running.push(worker(jobs, results))
    started = started + 1
  let sent = 0
  while sent < ${workers}:
    jobs.send(sent)
    sent = sent + 1
  let sum = 0
  let received = 0
  while received < ${workers}:
    sum = sum + await results.receive()
    received = received + 1
  sum
`);

/** A runtime as a host runs one, its heaps unchecked by the test runtime's oracle. */
const hosted = () => testRuntime({ heapCheck: noHeapCheck });

it(`${workers} workers on one inbox`, async ({ bench, expect }) => {
  const sum = String((workers * (workers - 1)) / 2);
  expect(await startToEnd(hosted(), text)).toEqual({ kind: 'finished', outcome: sum });
  await bench('start to end', async () => {
    await startToEnd(hosted(), text);
  }).run({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
});

const held = 500;
const dropped = 2000;

const releasing = compiledText(`
import * as runtime from 'runtime'

shared struct Lease:
  n: Int

fn dispose(self: Lease): ()

live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int:
  let kept: Array<Lease> = []
  for i in 0..${held}:
    kept.push(new Lease{n: i})
  let total = 0
  for i in 0..${dropped}:
    const lease = new Lease{n: i}
    total = total + lease->n
  total + kept.length()
`);

it(`${dropped} leases let go of beside ${held} held`, async ({ bench, expect }) => {
  const total = String((dropped * (dropped - 1)) / 2 + held);
  expect(await startToEnd(hosted(), releasing)).toEqual({ kind: 'finished', outcome: total });
  await bench('start to end', async () => {
    await startToEnd(hosted(), releasing);
  }).run({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
});

const boxes = 2000;
const segments = 500;

const waking = compiledText(`
import * as time from 'time'

shared struct Box:
  n: Int

live async fn main() -> Int:
  let kept: Array<Box> = []
  for i in 0..${boxes}:
    kept.push(new Box{n: i})
  let total = 0
  for i in 0..${segments}:
    await time.delay(0ms)
    total = total + kept[i]->n
  total
`);

it(`a live run waking ${segments} times beside ${boxes} held boxes`, async ({ bench, expect }) => {
  const total = String((segments * (segments - 1)) / 2);
  expect(await startToEnd(hosted(), waking)).toEqual({ kind: 'finished', outcome: total });
  await bench('start to end', async () => {
    await startToEnd(hosted(), waking);
  }).run({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
});
