// SPDX-License-Identifier: Apache-2.0

import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Lease } from '@asf/core';
import { digest } from '@asf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { harness, plan, task } from './helpers.js';

const opened: ReturnType<typeof harness>[] = [];
function create(options: Parameters<typeof harness>[0] = {}) {
  const value = harness(options);
  opened.push(value);
  return value;
}
afterEach(() => {
  for (const value of opened.splice(0)) value.dispose();
});
const envelope = (lease: Lease, sequence: number, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  missionId: lease.missionId,
  taskId: lease.taskId,
  attemptId: lease.attemptId,
  planHash: lease.planHash,
  token: lease.token,
  sequence,
  kind: 'finding',
  text: 'fixture observation',
  ...extra,
});

describe('P1-10/P1-11/P1-12 bounded fair concurrent scheduling', () => {
  it.each(['globalActive', 'hostActive', 'providerActive', 'missionActive'] as const)(
    'enforces the independently lowered %s ceiling',
    (limit) => {
      const h = create({ policy: { [limit]: 1 } });
      h.approve(plan('mission-a', [task('one'), task('two')]));
      const first = h.claim();
      expect(h.coordinator.dispatch('lowered-ceiling')).toBeNull();
      expect(h.coordinator.inspect('mission-a').queue[0]?.state).toBe('waiting_capacity');
      h.complete(first);
      expect(h.claim().taskId).toBe('two');
    },
  );
  it('overlaps two missions and parallel tasks without exceeding shared or mission limits', () => {
    const h = create();
    h.approve(plan('mission-a', [task('a'), task('b'), task('c')]));
    h.approve(plan('mission-b', [task('a'), task('b')]));
    const first = h.claim();
    const second = h.claim();
    const third = h.claim();
    expect([first.missionId, second.missionId, third.missionId]).toEqual([
      'mission-a',
      'mission-b',
      'mission-a',
    ]);
    expect(h.coordinator.inspect('mission-a').holders).toHaveLength(2);
    expect(h.coordinator.inspect('mission-b').holders).toHaveLength(1);
    expect(h.coordinator.dispatch('capacity-full')).toBeNull();
    h.complete(first);
    expect(h.claim().missionId).toBe('mission-b');
    expect(
      h.coordinator.inspect('mission-a').holders.length + h.coordinator.inspect('mission-b').holders.length,
    ).toBe(3);
  });
  it('ages lower-priority work to the maximum and schedules it within seven dispatch opportunities', () => {
    const h = create({ policy: { globalActive: 1 } });
    h.approve(
      plan(
        'mission-a',
        Array.from({ length: 12 }, (_, index) => task(`high-${index}`, { priority: 3 })),
      ),
    );
    h.approve(plan('mission-b', [task('small', { priority: 0 })]));
    const version = h.mission('mission-b').version;
    h.coordinator.setPriority('mission-b', 'small', 0, version, 'operator-priority');
    expect(() => h.coordinator.setPriority('mission-b', 'small', 1, version, 'stale-priority')).toThrow(
      'STALE_COMMAND',
    );
    const started: string[] = [];
    for (let index = 0; index < 7; index++) {
      const lease = h.claim();
      started.push(lease.missionId);
      h.complete(lease);
    }
    expect(started.indexOf('mission-b')).toBeLessThanOrEqual(6);
    expect(started).toContain('mission-b');
  });
  it('serializes the same actual allocation reached through aliases while independent work overlaps', () => {
    const h = create();
    symlinkSync('shared', join(h.workspaces, 'alias'));
    h.approve(
      plan('mission-a', [
        task('first', { resources: ['shared'] }),
        task('independent', { resources: ['other'] }),
      ]),
    );
    const other = plan('mission-b', [task('writer', { resources: ['alias'] })]);
    other.allocations.push({ id: 'alias', path: 'alias' });
    h.approve(other);
    expect(h.mission().allocations.shared).toBe(h.mission('mission-b').allocations.alias);
    const first = h.claim();
    const independent = h.claim();
    expect(first.missionId).toBe('mission-a');
    expect(independent.missionId).toBe('mission-a');
    expect(h.coordinator.inspect('mission-b').queue[0]?.state).toBe('waiting_resource');
    expect(h.coordinator.dispatch('conflict')).toBeNull();
    h.complete(first);
    expect(h.claim().missionId).toBe('mission-b');
  });
  it('rejects escaping allocations and counts descendants in the same capacity budget', () => {
    const h = create({ policy: { globalActive: 2 } });
    const escaped = plan();
    escaped.allocations[0] = { id: 'shared', path: '../outside' };
    expect(() => h.approve(escaped)).toThrow('ALLOCATION_ESCAPE');
    expect(h.ledger.all()).toEqual([]);
    h.approve(
      plan('mission-a', [
        task('parent'),
        task('child-a', { parentId: 'parent' }),
        task('child-b', { parentId: 'parent' }),
      ]),
    );
    h.claim();
    h.claim();
    expect(h.coordinator.dispatch('descendant-capacity')).toBeNull();
    const tooMany = plan('mission-b', [
      task('parent'),
      ...Array.from({ length: 5 }, (_, index) => task(`child-${index}`, { parentId: 'parent' })),
    ]);
    expect(() => h.approve(tooMany)).toThrow('FAN_OUT_BUDGET');
  });
});

describe('P1-07/P1-13/P1-14 cancellation, fencing and cleanup', () => {
  it('holds canceled work until quiescence and lets another mission progress without double release', () => {
    const h = create();
    h.approve(plan('mission-a', [task('a'), task('b')]));
    h.approve(plan('mission-b', [task('a'), task('b')]));
    const a = h.claim();
    const b = h.claim();
    h.coordinator.cancelMission('mission-a', h.mission().version, 'cancel');
    expect(h.mission().status).toBe('cancel_requested');
    expect(h.coordinator.inspect('mission-a').holders).toHaveLength(1);
    expect(() => h.coordinator.worker(a).send(envelope(a, 1))).toThrow('MISSION_NOT_RUNNABLE');
    h.complete(b);
    expect(h.claim().missionId).toBe('mission-b');
    h.coordinator.confirmStopped(a, 'stop');
    const cursor = h.ledger.snapshot().cursor;
    h.coordinator.confirmStopped(a, 'stop');
    expect(h.ledger.snapshot().cursor).toBe(cursor);
    expect(h.mission().status).toBe('canceled');
    expect(h.coordinator.inspect('mission-a').holders).toHaveLength(0);
    expect(() => h.coordinator.worker(a).send(envelope(a, 2))).toThrow('ATTEMPT_TERMINAL');
  });
  it('cancels a parent and its descendants without canceling independent work', () => {
    const h = create();
    h.approve(
      plan('mission-a', [
        task('parent', { priority: 3 }),
        task('child', { parentId: 'parent', priority: 2 }),
        task('other', { priority: 0 }),
      ]),
    );
    const parent = h.claim();
    const child = h.claim();
    h.coordinator.cancelTask('mission-a', 'parent', h.mission().version, 'cancel-parent');
    expect(h.mission().tasks.child?.status).toBe('cancel_requested');
    h.coordinator.confirmStopped(parent, 'parent-stopped');
    h.coordinator.confirmStopped(child, 'child-stopped');
    expect(h.mission().tasks.parent?.status).toBe('canceled');
    expect(h.mission().tasks.child?.status).toBe('canceled');
    expect(h.claim().taskId).toBe('other');
  });
  it('rejects expired outcomes, retains the conflict lease, and bounds retries', () => {
    const h = create();
    h.approve(
      plan('mission-a', [task('a', { resources: ['shared'] }), task('b', { resources: ['shared'] })]),
    );
    const old = h.claim();
    h.advance(30001);
    expect(() => h.coordinator.worker(old).heartbeat('late-heartbeat')).toThrow('LEASE_EXPIRED');
    h.coordinator.fenceExpired('mission-a', 'fence');
    expect(h.coordinator.inspect('mission-a').holders).toHaveLength(1);
    expect(h.coordinator.dispatch('still-held')).toBeNull();
    h.coordinator.confirmStopped(old, 'quiescent');
    const replacement = h.claim();
    expect(replacement.taskId).toBe(old.taskId);
    expect(replacement.attemptId).not.toBe(old.attemptId);
    expect(() => h.coordinator.worker(old).send(envelope(old, 1))).toThrow('STALE_ATTEMPT');
    h.advance(30001);
    h.coordinator.fenceExpired('mission-a', 'fence-again');
    h.coordinator.confirmStopped(replacement, 'quiescent-again');
    expect(h.mission().tasks.a?.attempts).toHaveLength(2);
    expect(h.mission().tasks.a?.status).toBe('blocked');
    expect(h.claim().taskId).toBe('b');
  });
  it('does not free a live allocation when the clock regresses and still permits cancellation', () => {
    const h = create();
    h.approve();
    h.claim();
    h.setTime(1);
    expect(() => h.coordinator.dispatch('clock-skew')).toThrow('CLOCK_REGRESSION');
    h.coordinator.cancelMission('mission-a', h.mission().version, 'stop-under-uncertainty');
    expect(h.coordinator.inspect('mission-a').holders).toHaveLength(1);
  });
  it('can stop owned attempts after a data budget is exhausted', () => {
    const h = create({ policy: { maxDataEvents: 1 } });
    h.approve(plan('mission-a', [task('one'), task('two')]));
    const lease = h.claim();
    expect(h.coordinator.inspect('mission-a').queue[0]).toMatchObject({
      state: 'blocked',
      reason: 'EVENT_BUDGET',
    });
    expect(() => h.coordinator.worker(lease).send(envelope(lease, 1))).toThrow('MESSAGE_BUDGET');
    expect(() => h.coordinator.worker(lease).heartbeat('heartbeat-after-budget')).toThrow('EVENT_BUDGET');
    h.coordinator.cancelMission('mission-a', h.mission().version, 'cancel-budget');
    h.coordinator.confirmStopped(lease, 'stopped-budget');
    expect(h.mission().status).toBe('canceled');
    expect(h.coordinator.dispatch('no-new-work')).toBeNull();
  });
});

describe('P1-09 durable producer ordering and scoped communications', () => {
  it('buffers gaps, rejects altered duplicates, and advances completion once', () => {
    const h = create();
    h.approve();
    const lease = h.claim();
    const hash = h.artifacts.putOutput(lease, 'research', { answer: 1 });
    const worker = h.coordinator.worker(lease);
    const completion = envelope(lease, 3, { kind: 'completed', outputDigest: hash });
    worker.send(completion);
    worker.send(completion);
    expect(h.coordinator.inspect('mission-a').telemetryGaps[0]?.expected).toBe(1);
    expect(h.mission().communicationCount).toBe(0);
    expect(() => worker.send({ ...completion, outputDigest: digest('changed') })).toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    worker.send(envelope(lease, 1));
    worker.send(envelope(lease, 2));
    expect(h.mission().communicationCount).toBe(3);
    expect(h.coordinator.inspect('mission-a').telemetryGaps).toEqual([]);
    h.coordinator.confirmFinished(lease, hash, 'finished');
    const cursor = h.ledger.snapshot().cursor;
    worker.send(completion);
    expect(h.ledger.snapshot().cursor).toBe(cursor);
    expect(h.mission().tasks.research?.attempts).toHaveLength(1);
  });
  it('keeps full recipient delivery beyond the presentation cache and isolates another mission', () => {
    const h = create();
    h.approve(plan('mission-a', [task('a'), task('receiver')]));
    h.approve(plan('mission-b'));
    const sender = h.claim();
    const foreign = h.claim();
    const recipient = h.claim();
    for (let sequence = 1; sequence <= 20; sequence++)
      h.coordinator
        .worker(sender)
        .send(envelope(sender, sequence, { recipientTaskId: 'receiver', text: `message-${sequence}` }));
    expect(h.mission().communications).toHaveLength(8);
    const inbox = h.coordinator.worker(recipient).inbox();
    expect(inbox.messages).toHaveLength(20);
    expect(inbox.messages.map((message) => message.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(h.coordinator.worker(foreign).inbox().messages).toHaveLength(0);
    expect(
      h.coordinator.worker(recipient).inbox({ ledgerId: inbox.ledgerId, after: inbox.cursor }).messages,
    ).toEqual([]);
    expect(() => h.coordinator.worker(recipient).inbox({ ledgerId: 'foreign', after: 0 })).toThrow(
      'CURSOR_LEDGER_MISMATCH',
    );
  });
  it('bounds gap buffering and prevents a worker request ID from suppressing operator cancellation', () => {
    const h = create({ policy: { maxGap: 2 } });
    h.approve();
    const lease = h.claim();
    const worker = h.coordinator.worker(lease);
    worker.send(envelope(lease, 3));
    worker.send(envelope(lease, 4));
    expect(() => worker.send(envelope(lease, 5))).toThrow('PRODUCER_GAP_BUDGET');
    worker.heartbeat('cancel-same-request');
    h.coordinator.cancelMission('mission-a', h.mission().version, 'cancel-same-request');
    expect(h.mission().status).toBe('cancel_requested');
  });
});
