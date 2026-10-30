// SPDX-License-Identifier: Apache-2.0
/** Trusted synthetic jobs. No model, shell, target repository or external publisher. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lease } from '@asf/core';
import { digest } from '@asf/core';
import type { Plan, TaskSpec } from '@asf/protocol';
import { ensure } from '@asf/protocol';
import { openContext } from './context.js';

type Context = ReturnType<typeof openContext>;
const vectors = [
  [2, 3, 5],
  [-4, 9, 5],
  [0, 0, 0],
  [100, 200, 300],
  [-3, -7, -10],
] as const;
export function fixtureTask(id: string, lab: TaskSpec['lab'], extra: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    lab,
    capabilities: [lab === 'production' ? 'fixture-write' : lab === 'qa' ? 'fixture-verify' : 'fixture-read'],
    dependencies: [],
    resources: [],
    requiredChecks: [],
    verifies: [],
    priority: 1,
    acceptance: ['Return the declared synthetic deliverable'],
    ...extra,
  };
}
export function fixturePlans(): Plan[] {
  const base = {
    schemaVersion: 1 as const,
    revision: 1,
    repositoryId: 'synthetic-calculator',
    snapshot: digest(vectors),
    allocations: [{ id: 'workspace', path: 'a' }],
    limits: { active: 2, attemptsPerTask: 2, fanOut: 4, depth: 2, deadlineMs: 300_000 },
  };
  return [
    {
      ...base,
      missionId: 'mission-a',
      tasks: [
        fixtureTask('research-facts', 'research'),
        fixtureTask('research-risks', 'research'),
        fixtureTask('production', 'production', {
          dependencies: [
            { taskId: 'research-facts', condition: 'completed' },
            { taskId: 'research-risks', condition: 'completed' },
          ],
          resources: ['workspace'],
          requiredChecks: ['calculation'],
        }),
        fixtureTask('qa', 'qa', {
          dependencies: [{ taskId: 'production', condition: 'completed' }],
          verifies: [{ taskId: 'production', checkId: 'calculation' }],
        }),
        fixtureTask('delivery', 'delivery', {
          dependencies: [
            { taskId: 'production', condition: 'verified' },
            { taskId: 'qa', condition: 'completed' },
          ],
        }),
      ],
    },
    {
      ...base,
      missionId: 'mission-b',
      allocations: [{ id: 'workspace', path: 'b' }],
      tasks: [fixtureTask('long-work', 'production', { resources: ['workspace'] })],
    },
  ];
}
function complete(context: Context, lease: Lease, body: unknown) {
  const task = context.ledger.read(lease.missionId)?.tasks[lease.taskId];
  ensure(task, 'UNKNOWN_TASK');
  const hash = context.artifacts.putOutput(lease, task.spec.lab, body);
  const { epoch: _epoch, ...identity } = lease;
  context.coordinator
    .worker(lease)
    .send({ schemaVersion: 1, ...identity, sequence: 1, kind: 'completed', outputDigest: hash });
  context.coordinator.confirmFinished(lease, hash, `finished-${lease.attemptId}`);
  return hash;
}
function finish(context: Context, lease: Lease) {
  const mission = context.ledger.read(lease.missionId);
  const task = mission?.tasks[lease.taskId];
  ensure(mission && task, 'UNKNOWN_TASK');
  if (task.spec.lab === 'research')
    return complete(context, lease, {
      schemaVersion: 1,
      lab: 'research',
      facts: ['Inputs and independent expected outputs are fixed'],
      sources: [digest(vectors)],
      uncertainties: [],
    });
  if (task.spec.lab === 'production')
    return complete(context, lease, {
      schemaVersion: 1,
      lab: 'production',
      implementation: { operation: 'sum', bias: task.attempts.length === 1 ? 1 : 0 },
      changes: ['Synthetic calculator data'],
      snapshot: mission.plan.snapshot,
    });
  if (task.spec.lab === 'qa') {
    const target = mission.tasks.production;
    ensure(target?.outputDigest, 'OUTPUT_MISSING');
    const producing = target.attempts.at(-1);
    ensure(producing, 'ATTEMPT_MISSING');
    const body = context.artifacts.read(mission.id, target.outputDigest).body as {
      implementation: { operation: string; bias: number };
    };
    const observations = vectors.map(([left, right, expected]) => ({
      left,
      right,
      expected,
      actual: left + right + body.implementation.bias,
    }));
    const result =
      body.implementation.operation === 'sum' && observations.every((row) => row.actual === row.expected)
        ? 'passed'
        : 'failed';
    complete(context, lease, {
      schemaVersion: 1,
      lab: 'qa',
      result,
      observations,
      inputDigest: target.outputDigest,
    });
    const evidence = context.artifacts.putEvidence(lease, 'qa', {
      schemaVersion: 1,
      missionId: mission.id,
      taskId: 'production',
      attemptId: producing.id,
      producingAttemptId: lease.attemptId,
      planHash: mission.planHash,
      checkId: 'calculation',
      inputDigest: target.outputDigest,
      environmentDigest: digest({ node: process.versions.node, evaluator: 'independent-sum-v1', vectors }),
      result,
      invocation: {
        kind: 'fixture-function',
        identifier: 'independent-sum-v1',
        arguments: [target.outputDigest, digest(vectors)],
      },
    });
    context.coordinator.recordEvidence(evidence, `evidence-${lease.attemptId}`);
    return result;
  }
  return complete(context, lease, {
    schemaVersion: 1,
    lab: 'delivery',
    destination: 'fixture://preview-only',
    payload: 'Synthetic calculator passes five independent vectors',
    externalAction: false,
  });
}
export function prepareDemo(state: string) {
  for (const path of ['', 'workspaces', 'workspaces/a', 'workspaces/b'])
    mkdirSync(join(state, path), { recursive: true, mode: 0o700 });
  const context = openContext(state);
  try {
    ensure(context.ledger.all().length === 0, 'DEMO_REQUIRES_EMPTY_STATE');
    for (const plan of fixturePlans()) {
      const result = context.coordinator.submitPlan(plan, 0, `submit-${plan.missionId}`);
      context.coordinator.approvePlan(
        plan.missionId,
        result.planHash,
        result.version,
        Date.now() + plan.limits.deadlineMs,
        `approve-${plan.missionId}`,
      );
    }
    const leases = [
      context.coordinator.dispatch('start-1'),
      context.coordinator.dispatch('start-2'),
      context.coordinator.dispatch('start-3'),
    ];
    ensure(
      leases.every((lease) => lease !== null),
      'OVERLAP_NOT_OBSERVED',
    );
    const owned = leases.filter((lease): lease is Lease => lease !== null);
    ensure(
      owned.filter((lease) => lease.missionId === 'mission-a').length === 2 &&
        owned.filter((lease) => lease.missionId === 'mission-b').length === 1,
      'CAPACITY_DEMONSTRATION',
    );
    for (const lease of owned.filter((lease) => lease.missionId === 'mission-a')) finish(context, lease);
    const produce = context.coordinator.dispatch('production-1');
    ensure(produce?.taskId === 'production', 'PRODUCTION_NOT_READY');
    finish(context, produce);
    const qa = context.coordinator.dispatch('qa-1');
    ensure(qa?.taskId === 'qa', 'QA_NOT_READY');
    ensure(finish(context, qa) === 'failed', 'WRONG_IMPLEMENTATION_ESCAPED');
    ensure(!context.coordinator.inspect('mission-a').deliveryReady, 'FAILED_QA_GATE');
    context.coordinator.requestRework('mission-a', 'production', 'rework-1');
    const b = context.ledger.read('mission-b');
    ensure(b, 'UNKNOWN_MISSION');
    context.coordinator.cancelMission(b.id, b.version, 'cancel-b');
    writeFileSync(
      join(state, 'demo-before-crash.json'),
      JSON.stringify(
        {
          leases: owned,
          signalBoundary: 'after-committed-rework-and-cancel',
          snapshot: context.ledger.snapshot(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return context; // caller deliberately kills its owned process, leaving durable ownership behind
  } catch (error) {
    context.ledger.close();
    throw error;
  }
}
export function resumeDemo(state: string) {
  const context = openContext(state);
  try {
    const before = context.ledger.read('mission-b');
    ensure(before?.status === 'cancel_requested', 'CANCEL_REQUEST_LOST');
    const old = before.tasks['long-work']?.attempts.at(-1);
    ensure(old, 'OLD_ATTEMPT_MISSING');
    const oldLease = {
      missionId: before.id,
      taskId: 'long-work',
      attemptId: old.id,
      token: old.token,
      epoch: old.epoch,
      planHash: before.planHash,
    };
    context.coordinator.recoverFake(before.id, 'recover-b');
    let staleRejected = false;
    try {
      context.coordinator.worker(oldLease).heartbeat('late-b');
    } catch {
      staleRejected = true;
    }
    ensure(staleRejected, 'OLD_EPOCH_ACCEPTED');
    for (let step = 0; step < 8; step++) {
      const lease = context.coordinator.dispatch(`resume-${step}`);
      if (!lease) break;
      finish(context, lease);
    }
    const a = context.coordinator.inspect('mission-a');
    const b = context.coordinator.inspect('mission-b');
    ensure(
      a.status === 'awaiting_action_approval' && a.deliveryReady && b.status === 'canceled',
      'DEMO_FINAL_STATE',
    );
    context.ledger.verify();
    const result = {
      simulation: true,
      restarted: true,
      staleRejected,
      externalActions: 0,
      snapshot: context.ledger.snapshot(),
      observations: {
        a: a.status,
        b: b.status,
        productionAttempts: a.tasks.production?.attempts.length,
        independentChecks: a.tasks.production?.evidence.map((item) => item.result),
      },
    };
    writeFileSync(join(state, 'demo-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally {
    context.ledger.close();
  }
}
