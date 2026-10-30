// SPDX-License-Identifier: Apache-2.0

import type { Lease } from '@asf/core';
import { activeTasks, held } from '@asf/core';
import { FactoryError } from '@asf/protocol';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { harness, plan, task } from './helpers.js';

it('preserves capacity, cancellation and mission boundaries under generated hostile interleavings', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 200 }), (commands) => {
      const h = harness();
      const leases: Lease[] = [];
      let canceled = false;
      try {
        h.approve(plan('mission-a', [task('one'), task('two')]));
        h.approve(plan('mission-b', [task('one'), task('two')]));
        for (const [index, command] of commands.entries()) {
          try {
            if (command === 0) {
              const lease = h.coordinator.dispatch(`generated-${index}`);
              if (lease) leases.push(lease);
            }
            if (command === 1 && leases[0]) h.complete(leases.shift()!);
            if (command === 2 && !canceled) {
              h.coordinator.cancelMission('mission-a', h.mission().version, `cancel-${index}`);
              canceled = true;
            }
            if (command === 3) {
              h.advance(31000);
              for (const id of ['mission-a', 'mission-b'])
                h.coordinator.fenceExpired(id, `fence-${index}${id}`);
            }
            if (command === 4 && leases[0]) h.coordinator.confirmStopped(leases.shift()!, `stop-${index}`);
            if (command === 5 && leases[0]) h.coordinator.worker(leases[0]).heartbeat(`heartbeat-${index}`);
            if (command === 6 && leases[0]) {
              const beforeB = h.mission('mission-b');
              const lease = leases[0];
              expect(() =>
                h.coordinator.worker(lease).send({
                  schemaVersion: 1,
                  missionId: 'forged',
                  taskId: lease.taskId,
                  attemptId: lease.attemptId,
                  token: lease.token,
                  planHash: lease.planHash,
                  sequence: 1,
                  kind: 'finding',
                }),
              ).toThrow();
              expect(h.mission('mission-b')).toEqual(beforeB);
            }
          } catch (error) {
            expect(error).toBeInstanceOf(FactoryError);
          }
          const missions = h.ledger.all();
          const active = missions.flatMap(activeTasks);
          expect(active.length).toBeLessThanOrEqual(3);
          for (const mission of missions) {
            expect(activeTasks(mission).length).toBeLessThanOrEqual(2);
            if (mission.status === 'canceled') expect(activeTasks(mission)).toHaveLength(0);
            for (const task of Object.values(mission.tasks)) {
              expect(task.attempts.length).toBeLessThanOrEqual(2);
              expect(task.attempts.filter(held).length).toBeLessThanOrEqual(1);
            }
          }
          if (canceled) expect(['cancel_requested', 'canceled']).toContain(h.mission().status);
        }
        h.ledger.verify();
      } finally {
        h.dispose();
      }
    }),
    { seed: 20261030, numRuns: 100 },
  );
}, 30000);
