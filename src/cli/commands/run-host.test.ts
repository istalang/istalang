/**
 * `ista run --host` end to end (§3.6, §9): a JavaScript module stands in for the host, implementing
 * the program's externs by key against JSON. A host type's value crosses as the host's own JSON, a
 * promise fills the future its extern returns, an extern constant is read from the host, and a
 * result as JSON says it maps back. What doesn't fit fails where the spec says: a result of the
 * wrong type panics the instance, JSON filling a future that doesn't fit fails the host's fill.
 * Spec §12's examples, read from the spec itself, run against a scripted host of queues.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { ista, tempProject as project } from '../cli.test-kit.ts';

const wrongResult =
  /^panic: The host gave what doesn't fit: main\.charge\.value: expected a string, found an integer\n/u;
const unfitFill =
  /^ista: the host couldn't fill a future of instance \S+: main\.receive\.amount: expected an integer, found a string\n/u;
const stuckAtReceive = /waits on nothing that can wake it, at \S+main\.ista:12:17, /u;
const requestsFailed =
  /^ista: the host's main\.receive\(main\.Queue<T>\) failed: Error: no more requests\n/u;
const mainStuck = /instance \S+ waits on nothing that can wake it/u;

/** A program receiving an order from a host queue and charging it through the host. */
const program = [
  'struct Order:',
  '  id: string',
  '  amount: int',
  '',
  'extern sendable struct Queue<T is Sendable>',
  'extern fn receive<T is Decodable>(self: Queue<T>) -> Future<T>',
  'extern fn orders() -> Queue<Order>',
  'extern fn charge(id: string, amount: int) -> Result<string>',
  'extern limit: int',
  '',
  'async fn main() -> Future<string>:',
  '  const order = await orders().receive()',
  '  if order.amount > limit:',
  '    return "too much"',
  '  match charge(order.id, order.amount):',
  '    case Ok{value}: "paid " + value',
  '    case Err{error}: "failed " + error.message',
  '',
].join('\n');

/** A host module answering the program's externs, `charge` and the queued order as given. */
function host(order: string, charge: string): string {
  return [
    'export default {',
    "  'main.orders()': () => 'orders',",
    `  'main.receive(main.Queue<T>)': (queue) => new Promise((resolve) => setTimeout(() => resolve(${order}), 5)),`,
    `  'main.charge(string, int)': (id, amount) => ${charge},`,
    "  'main.limit': () => 100,",
    '};',
    '',
  ].join('\n');
}

/** The code of every spec example in `section` that `wanted` picks. */
function specCode(section: string, wanted: (code: string) => boolean): string[] {
  const found = specExamples
    .filter((example) => example.section === section && wanted(example.code))
    .map(({ code }) => code);
  if (found.length === 0) {
    throw new Error(`No example in "${section}" is the one wanted.`);
  }
  return found;
}

/**
 * The host spec §12 declares, scripted: a queue is named after what it carries, and logs to
 * `queue.log` every send, retraction and charge, a send by the token it gave. The purchase requests
 * hold one request, then fail; a purchase's verdicts arrive one after the other, and its cancels
 * late, once nothing waits on them, so filling them changes nothing.
 */
const specHost = [
  "import { appendFileSync } from 'node:fs';",
  '/** Logs `line`, and gives what an extern returning `unit` does. */',
  'const log = (line) => {',
  "  appendFileSync(new URL('./queue.log', import.meta.url), line + '\\n');",
  '  return null;',
  '};',
  "const sendRevertible = 'main.sendRevertible(main.Queue<T>, T)';",
  "const verdicts = [{ role: 'legal', ok: true, comment: '' }, { role: 'finance', ok: true, comment: '' }];",
  "const requests = [{ id: 'p1', item: 'laptop', amount: 900 }];",
  '/** A promise of what a receive from `queue` gets next. */',
  'const next = (queue) => {',
  "  if (queue === 'requests') {",
  '    return requests.length > 0',
  '      ? Promise.resolve(requests.shift())',
  "      : Promise.reject(new Error('no more requests'));",
  '  }',
  "  return queue.startsWith('verdicts')",
  '    ? new Promise((resolve) => setTimeout(() => resolve(verdicts.shift()), 5))',
  "    : new Promise((resolve) => setTimeout(() => resolve({ reason: 'late' }), 50));",
  '};',
  'export default {',
  "  'main.purchaseRequests': () => 'requests',",
  "  'main.announcements(string)': (user) => user,",
  "  'main.reviewQueue(string)': (role) => role,",
  "  'main.notifications(string)': (role) => role,",
  "  'main.verdicts(string)': (id) => 'verdicts ' + id,",
  "  'main.cancels(string)': (id) => 'cancels ' + id,",
  "  'main.send(main.Queue<T>, T)': (queue) => log('durable ' + queue),",
  '  [sendRevertible]: (queue, message) => {',
  "    const token = queue + ':' + (message.text ?? message.purchaseId);",
  "    log('send ' + token);",
  '    return token;',
  '  },',
  "  [sendRevertible + '.retract']: (token) => log('retract ' + token),",
  "  'main.receive(main.Queue<T>)': next,",
  "  'main.chargeCard(string, int)': (id, amount) => {",
  "    log('charge ' + id + ' ' + amount);",
  "    return { type: 'Ok', value: 'r-' + id + '-' + amount };",
  '  },',
  '};',
  '',
].join('\n');

/**
 * What the host logs of purchase `p1` going through §12.1's approval: a review request sent to
 * each role, then the card charged and both requests retracted once approval ended.
 */
const purchased = {
  sent: ['send legal:p1', 'send finance:p1'],
  after: ['charge p1 900', 'retract finance:p1', 'retract legal:p1'],
};

/**
 * Runs `lines`, a module of spec §12, against the scripted host: what it printed, the sends it
 * logged in order, and what it logged after them, sorted.
 */
async function runSpec(lines: readonly string[]) {
  const root = project({ 'main.ista': [...lines, ''].join('\n'), 'host.mjs': specHost });
  const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
  const log = readFileSync(join(root, 'queue.log'), 'utf8').split('\n').filter(Boolean);
  const isSend = (line: string) => line.startsWith('send ');
  return { run, sent: log.filter(isSend), after: log.filter((line) => !isSend(line)).toSorted() };
}

/** Runs `program` with a host module of `order` and `charge`. */
function runWith(order: string, charge: string) {
  const root = project({ 'main.ista': program, 'host.mjs': host(order, charge) });
  return ista(root, 'run', 'main.ista', '--host', 'host.mjs');
}

describe('ista run --host', () => {
  it('runs the host externs: a host type, a promised future, a constant and a result', async () => {
    const run = await runWith(
      "{ id: 'o-' + queue, amount: 50 }",
      "({ type: 'Ok', value: 'r-' + id + '-' + amount })",
    );
    expect(run).toEqual({ code: 0, out: '"paid r-o-orders-50"\n', err: '' });
  });

  it('reads a host value against the declared type, an Err as data', async () => {
    const run = await runWith(
      "{ id: 'o1', amount: 50 }",
      "({ type: 'Err', error: { message: 'declined', code: 'card', trace: '' } })",
    );
    expect(run).toEqual({ code: 0, out: '"failed declined"\n', err: '' });
  });

  it('panics the instance on a host result of the wrong type', async () => {
    const run = await runWith("{ id: 'o1', amount: 50 }", "({ type: 'Ok', value: 5 })");
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(wrongResult);
  });

  it("fails the host's fill on JSON that doesn't fit, leaving the future to wait", async () => {
    const run = await runWith("{ id: 'o1', amount: 'many' }", "({ type: 'Ok', value: 'r' })");
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(unfitFill);
    expect(run.err).toMatch(stuckAtReceive);
  });

  it('refuses to run when the host leaves an extern unimplemented, naming its key', async () => {
    const root = project({
      'main.ista': program,
      'host.mjs': "export default { 'main.limit': () => 1 };\n",
    });
    const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
    expect(run.code).toBe(1);
    expect(run.err).toContain('main.charge(string, int)');
  });

  it('keeps waiting on the promises still pending after one of them fails', async () => {
    const root = project({
      'main.ista': [
        'extern fn later(name: string) -> Future<string>',
        'async fn main() -> Future<string>:',
        '  _ = later("fail")',
        '  await later("ok")',
        '',
      ].join('\n'),
      'host.mjs': [
        'export default {',
        "  'main.later(string)': (name) =>",
        "    name === 'fail'",
        "      ? Promise.reject(new Error('no'))",
        "      : new Promise((resolve) => setTimeout(() => resolve('fine'), 30)),",
        '};',
        '',
      ].join('\n'),
    });
    const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
    expect(run).toEqual({
      code: 0,
      out: '"fine"\n',
      err: "ista: the host's main.later(string) failed: Error: no\n",
    });
  });

  it('runs spec §12.1 and §12.2: a purchase spawned for each request, until requests fail', async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval', () => true),
      ...specCode('12.2 Approver side', () => true),
    ]);
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(requestsFailed);
    expect(run.err).toMatch(mainStuck);
    expect(logged).toEqual(purchased);
  });

  it("runs spec §12.1's purchase in place, to the outcome its charge gives", async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval', (code) => !code.includes('spawn purchase')),
      'async fn main() -> Future<string>:',
      '    await purchase(PurchaseRequest{id: "p1", item: "laptop", amount: 900})',
    ]);
    expect(run).toEqual({ code: 0, out: '"paid: r-p1-900"\n', err: '' });
    expect(logged).toEqual(purchased);
  });

  it("runs spec §12.3, retracting every unread copy through the host's queue when it ends", async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval', (code) =>
        code.includes('extern sendable struct Queue'),
      ),
      ...specCode('12.3 Broadcast with expiry', () => true).map((code) =>
        code.replace("import * as time from 'time'\n", ''),
      ),
      'async fn main() -> Future<string>:',
      '    await announce("hello", ["ann", "bob"], 10ms)',
      '    "done"',
    ]);
    expect(run).toEqual({ code: 0, out: '"done"\n', err: '' });
    expect(logged).toEqual({
      sent: ['send ann:hello', 'send bob:hello'],
      after: ['retract ann:hello', 'retract bob:hello'],
    });
  });
});
