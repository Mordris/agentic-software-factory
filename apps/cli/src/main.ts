// SPDX-License-Identifier: Apache-2.0
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '@asf/core';
import { ensure, FactoryError, parseJson, planInput } from '@asf/protocol';
import { SqliteLedger } from '@asf/store-sqlite';
import { openContext } from './context.js';
import { runDemo } from './demo.js';
import { prepareDemo } from './fixtures.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function readJsonFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    ensure(fstatSync(fd).isFile(), 'LOCAL_FILE_POLICY');
    const buffer = Buffer.alloc(65537);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    ensure(length <= 65536, 'INPUT_TOO_LARGE');
    return parseJson(buffer.subarray(0, length).toString('utf8'));
  } finally {
    closeSync(fd);
  }
}
const toolchain = JSON.parse(readFileSync(join(root, 'toolchain.json'), 'utf8')) as {
  node: { version: string };
  sqlite: { version: string; source_id: string };
  pnpm: { version: string };
  python: { version: string };
};
async function main() {
  ensure(process.versions.node === toolchain.node.version, 'NODE_VERSION_MISMATCH');
  const [command = 'help', ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    ensure(typeof key === 'string', 'INVALID_ARGUMENTS');
    ensure(
      key?.startsWith('--') && value && !value.startsWith('--') && !Object.hasOwn(flags, key),
      'INVALID_ARGUMENTS',
    );
    flags[key] = value;
  }
  const contracts: Record<string, string[]> = {
    help: [],
    versions: [],
    demo: ['state'],
    'fixture-pause': ['state'],
    status: ['state'],
    events: ['state', 'ledger-id', 'after'],
    'plan-preview': ['file'],
    submit: ['state', 'file', 'expected-version', 'request-id'],
    'approve-plan': ['state', 'mission', 'hash', 'expected-version', 'expires-at', 'request-id'],
    cancel: ['state', 'mission', 'expected-version', 'request-id'],
    evidence: ['state', 'mission'],
  };
  ensure(Object.hasOwn(contracts, command), 'UNSUPPORTED_COMMAND');
  const required = contracts[command]!;
  ensure(
    required.every((key) => flags[`--${key}`]) &&
      Object.keys(flags).every((key) => required.includes(key.slice(2))),
    'INVALID_ARGUMENTS',
  );
  const arg = (key: string): string => {
    const value = flags[`--${key}`];
    ensure(value, 'MISSING_ARGUMENT');
    return value;
  };
  const number = (key: string): number => {
    const source = arg(key);
    ensure(/^\d+$/.test(source) && Number.isSafeInteger(Number(source)), 'INVALID_INTEGER');
    return Number(source);
  };
  if (command === 'help')
    return {
      schemaVersion: 1,
      stage: 'simulated-core',
      commands: Object.keys(contracts).filter((key) => key !== 'fixture-pause'),
      externalExecutor: false,
    };
  if (command === 'versions')
    return {
      node: process.versions.node,
      sqlite: toolchain.sqlite,
      pnpm: toolchain.pnpm.version,
      python: toolchain.python.version,
      note: 'SQLite identity is probed before opening any ledger; other executable checks belong to check_toolchain.py.',
    };
  if (command === 'plan-preview') {
    const plan = planInput(readJsonFile(arg('file')));
    return { plan, planHash: digest(plan), authority: 'none' };
  }
  const state = resolve(arg('state'));
  if (command === 'demo') return runDemo(state);
  if (command === 'fixture-pause') {
    prepareDemo(state);
    writeSync(1, `${JSON.stringify({ boundary: 'ready-for-owned-kill', pid: process.pid })}\n`);
    process.kill(process.pid, 'SIGSTOP');
    throw new FactoryError('EXPECTED_OWNED_KILL');
  }
  if (['status', 'events', 'evidence'].includes(command)) {
    const ledger = new SqliteLedger({ path: join(state, 'ledger.sqlite'), readonly: true });
    try {
      if (command === 'events') return { events: ledger.events(arg('ledger-id'), number('after')) };
      if (command === 'evidence') {
        const mission = ledger.read(arg('mission'));
        ensure(mission, 'UNKNOWN_MISSION');
        return {
          missionId: mission.id,
          evidence: Object.values(mission.tasks).flatMap((task) => task.evidence),
        };
      }
      return { snapshot: ledger.snapshot(), authority: 'read-only' };
    } finally {
      ledger.close();
    }
  }
  const context = openContext(state);
  try {
    if (command === 'submit')
      return context.coordinator.submitPlan(
        readJsonFile(arg('file')),
        number('expected-version'),
        arg('request-id'),
      );
    if (command === 'approve-plan')
      return context.coordinator.approvePlan(
        arg('mission'),
        arg('hash'),
        number('expected-version'),
        number('expires-at'),
        arg('request-id'),
      );
    return context.coordinator.cancelMission(arg('mission'), number('expected-version'), arg('request-id'));
  } finally {
    context.ledger.close();
  }
}
try {
  const result = await main();
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: error instanceof FactoryError ? error.code : 'LOCAL_FAILURE',
        message: error instanceof Error ? error.message : 'Unknown local error',
      },
    })}\n`,
  );
  process.exitCode = 1;
}
