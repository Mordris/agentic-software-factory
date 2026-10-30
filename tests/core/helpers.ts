// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Lease, Policy } from '@asf/core';
import { Coordinator, digest, POLICY } from '@asf/core';
import type { Evidence, Plan, TaskSpec } from '@asf/protocol';
import { ensure } from '@asf/protocol';
import type { StoreOptions } from '@asf/store-sqlite';
import { ArtifactStore, SqliteLedger } from '@asf/store-sqlite';

export function task(id = 'research', overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    lab: 'research',
    capabilities: ['fixture-read'],
    dependencies: [],
    resources: [],
    requiredChecks: [],
    verifies: [],
    priority: 1,
    acceptance: ['Return the fixture facts'],
    ...overrides,
  };
}
export function plan(id = 'mission-a', tasks: TaskSpec[] = [task()]): Plan {
  return {
    schemaVersion: 1,
    missionId: id,
    revision: 1,
    repositoryId: 'fixture-repo',
    snapshot: digest({ fixture: 'sum', inputs: [2, 3] }),
    allocations: [
      { id: 'shared', path: 'shared' },
      { id: 'other', path: 'other' },
    ],
    tasks,
    limits: { active: 2, attemptsPerTask: 2, fanOut: 4, depth: 2, deadlineMs: 100_000 },
  };
}
export function harness(options: { policy?: Partial<Policy>; fault?: StoreOptions['fault'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'asf-core-'));
  const workspaces = join(root, 'workspaces');
  mkdirSync(workspaces);
  mkdirSync(join(workspaces, 'shared'));
  mkdirSync(join(workspaces, 'other'));
  const ledger = new SqliteLedger({
    path: join(root, 'ledger.sqlite'),
    ...(options.fault ? { fault: options.fault } : {}),
  });
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  let now = 1000;
  let ids = 0;
  const resolveResource = (path: string): string => {
    ensure(!isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'ALLOCATION_ESCAPE');
    const target = realpathSync(resolve(workspaces, path));
    ensure(
      !relative(workspaces, target).startsWith('..') && !isAbsolute(relative(workspaces, target)),
      'ALLOCATION_ESCAPE',
    );
    const entry = statSync(target);
    return digest({ host: 'fixture-local', device: entry.dev, inode: entry.ino });
  };
  const coordinator = new Coordinator(ledger, {
    clock: () => now,
    operatorId: 'fixture-operator',
    makeId: () => `id-${++ids}`,
    resolveResource,
    verifyArtifact: (lease, hash, lab) => artifacts.verifyOutput(lease, hash, lab),
    verifyEvidence: (receipt, producer) => artifacts.verifyEvidence(receipt, producer),
    policy: { ...structuredClone(POLICY), ...options.policy },
  });
  const mission = (id = 'mission-a') => {
    const value = ledger.read(id);
    ensure(value, 'UNKNOWN_MISSION');
    return value;
  };
  const approve = (value = plan()) => {
    const submitted = coordinator.submitPlan(value, 0, `submit-${value.missionId}`);
    coordinator.approvePlan(
      value.missionId,
      submitted.planHash,
      submitted.version,
      now + value.limits.deadlineMs,
      `approve-${value.missionId}`,
    );
    return mission(value.missionId);
  };
  const claim = (): Lease => {
    const lease = coordinator.dispatch(`dispatch-${++ids}`);
    ensure(lease, 'NO_READY_TASK');
    return lease;
  };
  const complete = (lease: Lease, body: unknown = { fixture: 'output' }) => {
    const spec = mission(lease.missionId).tasks[lease.taskId]?.spec;
    ensure(spec, 'UNKNOWN_TASK');
    const hash = artifacts.putOutput(lease, spec.lab, body);
    coordinator.worker(lease).send({
      schemaVersion: 1,
      missionId: lease.missionId,
      taskId: lease.taskId,
      attemptId: lease.attemptId,
      planHash: lease.planHash,
      token: lease.token,
      sequence: 1,
      kind: 'completed',
      outputDigest: hash,
    });
    coordinator.confirmFinished(lease, hash, `finish-${lease.attemptId}`);
    return hash;
  };
  const check = (producer: Lease, targetId: string, result: Evidence['result']) => {
    const current = mission(producer.missionId);
    const target = current.tasks[targetId];
    const source = current.tasks[producer.taskId];
    ensure(target?.outputDigest && source, 'OUTPUT_MISSING');
    const attempt = target.attempts.at(-1);
    ensure(attempt, 'ATTEMPT_MISSING');
    const receipt = artifacts.putEvidence(producer, source.spec.lab, {
      schemaVersion: 1,
      missionId: current.id,
      taskId: targetId,
      attemptId: attempt.id,
      producingAttemptId: producer.attemptId,
      planHash: current.planHash,
      checkId: 'calculation',
      inputDigest: target.outputDigest,
      environmentDigest: digest({ node: process.versions.node, fixture: 'independent-calculation-v1' }),
      result,
      invocation: { kind: 'fixture-function', identifier: 'calculation-v1', arguments: ['2', '3', '5'] },
    });
    coordinator.recordEvidence(receipt, `evidence-${++ids}`);
    return receipt;
  };
  return {
    root,
    workspaces,
    ledger,
    artifacts,
    coordinator,
    mission,
    approve,
    claim,
    complete,
    check,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    setTime: (value: number) => {
      now = value;
    },
    dispose: () => {
      ledger.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export function verifiedPlan(id = 'mission-a'): Plan {
  return plan(id, [
    task('produce', { lab: 'production', capabilities: ['fixture-write'], requiredChecks: ['calculation'] }),
    task('verify', {
      lab: 'qa',
      capabilities: ['fixture-verify'],
      dependencies: [{ taskId: 'produce', condition: 'completed' }],
      verifies: [{ taskId: 'produce', checkId: 'calculation' }],
    }),
  ]);
}
