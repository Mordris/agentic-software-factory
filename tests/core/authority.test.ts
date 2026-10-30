// SPDX-License-Identifier: Apache-2.0

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '@asf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { harness, plan, verifiedPlan } from './helpers.js';

const opened: ReturnType<typeof harness>[] = [];
const create = () => {
  const value = harness();
  opened.push(value);
  return value;
};
afterEach(() => {
  for (const value of opened.splice(0)) value.dispose();
});
describe('P1-03/P1-04 plan and action authority', () => {
  it('does not dispatch without an exact current operator approval; worker payload cannot mint one', () => {
    const h = create();
    const input = plan();
    const submitted = h.coordinator.submitPlan(input, 0, 'submit');
    expect(h.coordinator.dispatch('no-approval')).toBeNull();
    expect(h.mission().tasks.research?.attempts).toHaveLength(0);
    expect(() =>
      h.coordinator.approvePlan(input.missionId, '0'.repeat(64), submitted.version, h.now() + 1000, 'forged'),
    ).toThrow('APPROVAL_HASH_MISMATCH');
    h.coordinator.approvePlan(
      input.missionId,
      submitted.planHash,
      submitted.version,
      h.now() + 1000,
      'approve',
    );
    const lease = h.claim();
    const worker = h.coordinator.worker(lease);
    expect(Object.keys(worker).sort()).toEqual(['heartbeat', 'inbox', 'send']);
    expect(() =>
      worker.send({ schemaVersion: 1, kind: 'approve-plan', role: 'operator', approved: true }),
    ).toThrow('INVALID_ENVELOPE');
    expect(() => h.coordinator.cancelMission(input.missionId, 1, 'stale-control')).toThrow('STALE_COMMAND');
  });
  it('makes approval expiry and immutable plan revision binding observable', () => {
    const h = create();
    h.approve();
    h.advance(100001);
    expect(h.coordinator.dispatch('expired')).toBeNull();
    const prior = h.mission();
    const revised = { ...prior.plan, revision: 2, snapshot: digest({ changed: true }) };
    h.coordinator.submitPlan(revised, prior.version, 'revise');
    expect(h.mission().approval).toBeNull();
    expect(h.coordinator.dispatch('revised-unapproved')).toBeNull();
  });
  it('binds exact action payload/destination/state/expiry and consumes a record once without any executor', () => {
    const h = create();
    h.approve();
    const lease = h.claim();
    h.complete(lease);
    const action = {
      id: 'delivery-1',
      missionId: lease.missionId,
      planHash: lease.planHash,
      type: 'pr' as const,
      destination: 'fixture-only',
      payloadDigest: digest({ patch: 1 }),
      expectedState: digest({ base: 1 }),
      expiresAt: h.now() + 1000,
    };
    h.coordinator.approveAction(action, h.mission().version, 'approve-action');
    for (const changed of [
      { ...action, destination: 'elsewhere' },
      { ...action, payloadDigest: digest('changed') },
      { ...action, expectedState: digest('changed') },
    ])
      expect(() => h.coordinator.consumeActionForSimulation(changed, `changed-${digest(changed)}`)).toThrow(
        'ACTION_BINDING',
      );
    h.coordinator.consumeActionForSimulation(action, 'consume');
    expect(() => h.coordinator.consumeActionForSimulation(action, 'replay-new-id')).toThrow('ACTION_BINDING');
    expect(h.mission().status).toBe('awaiting_action_approval');
  });
});
describe('P1-06/P1-15/P1-16 independent evidence and artifact identity', () => {
  it('rejects mission substitution and a worker completion assertion without a trusted supervisor receipt', () => {
    const h = create();
    h.approve();
    h.approve(plan('mission-b'));
    const lease = h.claim();
    const message = {
      schemaVersion: 1,
      ...lease,
      sequence: 1,
      kind: 'completed',
      outputDigest: digest('missing'),
    };
    const { epoch: _epoch, ...envelope } = message;
    expect(() => h.coordinator.worker(lease).send({ ...envelope, missionId: 'mission-b' })).toThrow(
      'MESSAGE_SCOPE',
    );
    h.coordinator.worker(lease).send(envelope);
    expect(h.mission(lease.missionId).status).toBe('running');
    expect(() => h.coordinator.confirmFinished(lease, message.outputDigest, 'unproven')).toThrow(
      'OUTPUT_MISSING_OR_TAMPERED',
    );
    expect(h.coordinator.inspect(lease.missionId).holders).toHaveLength(1);
  });
  it.each(['failed', 'skipped', 'canceled', 'blocked', 'inconclusive'] as const)(
    'blocks readiness for a required %s check',
    (classification) => {
      const h = create();
      h.approve(verifiedPlan());
      const production = h.claim();
      h.complete(production, { operation: 'add', bias: 1 });
      expect(h.coordinator.inspect('mission-a').deliveryReady).toBe(false);
      const qa = h.claim();
      h.complete(qa);
      const receipt = h.check(qa, 'produce', classification);
      expect(h.coordinator.inspect('mission-a').deliveryReady).toBe(false);
      expect(() => h.coordinator.recordEvidence({ ...receipt, result: 'passed' }, 'self-certify')).toThrow(
        'UNVERIFIED_RECEIPT',
      );
    },
  );
  it('detects a deliberately wrong fixture, preserves failed QA, and accepts bounded corrected rework', () => {
    const h = create();
    h.approve(verifiedPlan());
    const first = h.claim();
    const wrong = h.complete(first, { operation: 'add', bias: 1 });
    const evaluate = (hash: string) => {
      const data = h.artifacts.read('mission-a', hash).body as { operation: string; bias: number };
      return (data.operation === 'add' ? 2 + 3 : 2 - 3) + data.bias === 5;
    };
    const qa = h.claim();
    h.complete(qa);
    expect(evaluate(wrong)).toBe(false);
    const old = h.check(qa, 'produce', 'failed');
    h.coordinator.requestRework('mission-a', 'produce', 'rework');
    const corrected = h.claim();
    const correct = h.complete(corrected, { operation: 'add', bias: 0 });
    expect(() => h.coordinator.recordEvidence({ ...old, inputDigest: correct }, 'stale-qa')).toThrow();
    const secondQa = h.claim();
    h.complete(secondQa);
    expect(evaluate(correct)).toBe(true);
    h.check(secondQa, 'produce', 'passed');
    expect(h.coordinator.inspect('mission-a').deliveryReady).toBe(true);
    expect(h.mission().tasks.produce?.evidence.map((evidence) => evidence.result)).toEqual([
      'failed',
      'passed',
    ]);
    writeFileSync(join(h.artifacts.root, 'mission-a', correct), 'tampered');
    expect(h.coordinator.inspect('mission-a').deliveryReady).toBe(false);
  });
  it('rejects self-certification by Production and wrong-source evidence', () => {
    const h = create();
    h.approve(verifiedPlan());
    const production = h.claim();
    h.complete(production);
    const qa = h.claim();
    h.complete(qa);
    const valid = h.check(qa, 'produce', 'passed');
    expect(() =>
      h.coordinator.recordEvidence({ ...valid, producingAttemptId: production.attemptId }, 'self'),
    ).toThrow('SELF_VERIFICATION');
    expect(() =>
      h.coordinator.recordEvidence({ ...valid, inputDigest: digest('other-snapshot') }, 'stale'),
    ).toThrow('STALE_EVIDENCE');
  });
});
