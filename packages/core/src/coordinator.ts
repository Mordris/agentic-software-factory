// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import type { Envelope, Evidence, LabId } from '@asf/protocol';
import { actionInput, canonical, ensure, envelopeInput, evidenceInput, planInput } from '@asf/protocol';
import { digest } from './hash.js';
import type { Attempt, Change, Ledger, Mission, Policy, Task, View } from './model.js';
import { activeTasks, held, latest, POLICY } from './model.js';
import { authorized, claimable, currentTask, outputOf, planHash, refresh, validateGraph } from './policy.js';

export interface Lease {
  missionId: string;
  taskId: string;
  attemptId: string;
  token: string;
  planHash: string;
  epoch: number;
}
export interface CoordinatorOptions {
  clock: () => number;
  resolveResource: (path: string) => string;
  operatorId: string;
  verifyArtifact: (lease: Lease, outputDigest: string, lab: LabId) => boolean;
  verifyEvidence: (evidence: Evidence, producerTaskId: string) => boolean;
  makeId?: () => string;
  policy?: Policy;
}

/** Only trusted host code holds this object; a worker receives worker(lease), never the coordinator. */
export class Coordinator {
  readonly #ledger: Ledger;
  readonly #options: CoordinatorOptions;
  readonly #policy: Policy;
  #lastTime = 0;
  constructor(ledger: Ledger, options: CoordinatorOptions) {
    this.#ledger = ledger;
    this.#options = options;
    this.#policy = structuredClone(options.policy ?? POLICY);
    for (const field of [
      'globalActive',
      'hostActive',
      'providerActive',
      'missionActive',
      'activeMissions',
      'maxGap',
      'maxGapBytes',
      'maxMessages',
      'maxDataEvents',
    ] as const) {
      ensure(this.#policy[field] >= 1 && this.#policy[field] <= POLICY[field], 'POLICY_EXCEEDS_ENVELOPE');
    }
    ensure(this.#policy.leaseMs >= 1 && this.#policy.leaseMs <= POLICY.leaseMs, 'POLICY_EXCEEDS_ENVELOPE');
    for (const [lab, capabilities] of Object.entries(this.#policy.capabilities))
      ensure(
        capabilities.every((capability) => POLICY.capabilities[lab]?.includes(capability)),
        'POLICY_CAPABILITY_EXPANSION',
      );
  }
  #time(control = false): number {
    const now = this.#options.clock();
    ensure(Number.isSafeInteger(now) && now >= 0, 'INVALID_CLOCK');
    ensure(control || now >= this.#lastTime, 'CLOCK_REGRESSION');
    this.#lastTime = Math.max(this.#lastTime, now);
    return this.#lastTime;
  }
  #mission(view: View, id: string): Mission {
    const mission = view.missions.find((item) => item.id === id);
    ensure(mission, 'UNKNOWN_MISSION');
    return structuredClone(mission);
  }
  #edit<T>(
    id: string,
    key: string,
    input: unknown,
    kind: string,
    edit: (mission: Mission, view: View, now: number) => T,
    control = false,
    details: Record<string, unknown> = {},
  ): T {
    const now = this.#time(control);
    const operator = [
      'plan.approved',
      'mission.cancel_requested',
      'task.cancel_requested',
      'task.priority_changed',
      'action.approved',
      'action.simulated_use',
    ].includes(kind);
    const worker = kind === 'worker.message' || kind === 'attempt.heartbeat';
    if (worker) ensure(typeof details.producer === 'string', 'WORKER_IDENTITY');
    const actor = worker
      ? `worker:${String(details.producer)}`
      : operator
        ? `operator:${this.#options.operatorId}`
        : 'supervisor:fixture-local';
    return this.#ledger.transact(`${id}:${actor}`, key, digest({ kind, input, actor }), now, (view) => {
      const mission = this.#mission(view, id);
      const result = edit(mission, view, now);
      mission.version++;
      refresh(mission, view.round);
      return { mission, kind, details: { ...details, actor }, value: result };
    });
  }
  #owned(mission: Mission, lease: Lease, now: number, expired = false): { task: Task; attempt: Attempt } {
    ensure(mission.planHash === lease.planHash && mission.id === lease.missionId, 'STALE_PLAN');
    const task = currentTask(mission, lease.taskId);
    const attempt = latest(task);
    ensure(
      attempt?.id === lease.attemptId &&
        attempt.token === lease.token &&
        attempt.epoch === lease.epoch &&
        lease.epoch === this.#ledger.epoch,
      'STALE_ATTEMPT',
    );
    ensure(held(attempt), 'ATTEMPT_TERMINAL');
    if (!expired) {
      ensure(attempt.status !== 'fenced' && attempt.leaseUntil > now, 'LEASE_EXPIRED');
      authorized(mission, now);
    }
    return { task, attempt };
  }
  #version(mission: Mission, expected: number): void {
    ensure(mission.version === expected, 'STALE_COMMAND');
  }
  #id(): string {
    const value = (this.#options.makeId ?? randomUUID)();
    ensure(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value), 'INVALID_GENERATED_ID');
    return value;
  }

  submitPlan(
    value: unknown,
    expectedVersion: number,
    requestId: string,
  ): { planHash: string; version: number } {
    const plan = planInput(value);
    validateGraph(plan, this.#policy);
    const hash = planHash(plan);
    const now = this.#time();
    const allocations = Object.fromEntries(
      plan.allocations.map((item) => [item.id, this.#options.resolveResource(item.path)]),
    );
    return this.#ledger.transact(
      `${plan.missionId}:operator:${this.#options.operatorId}`,
      requestId,
      digest({ kind: 'plan.submit', plan, expectedVersion }),
      now,
      (view) => {
        const previous = view.missions.find((item) => item.id === plan.missionId);
        ensure((previous?.version ?? 0) === expectedVersion, 'STALE_COMMAND');
        if (previous) {
          ensure(
            activeTasks(previous).length === 0 && plan.revision > previous.plan.revision,
            'ACTIVE_OR_OLD_PLAN',
          );
        }
        const tasks: Record<string, Task> = {};
        for (const spec of plan.tasks)
          tasks[spec.id] = {
            spec,
            status: 'pending',
            attempts: [],
            evidence: [],
            outputDigest: null,
            priority: spec.priority,
            readyRound: view.round,
            reason: null,
          };
        const mission: Mission = {
          schemaVersion: 1,
          id: plan.missionId,
          version: expectedVersion + 1,
          plan,
          planHash: hash,
          approval: null,
          status: 'awaiting_plan_approval',
          tasks,
          allocations,
          actions: [],
          communications: [],
          communicationCount: 0,
          dataEventCount: 0,
          createdAt: now,
          deadline: Number.MAX_SAFE_INTEGER,
          lastScheduledRound: 0,
          reason: null,
        };
        return {
          mission,
          kind: 'plan.submitted',
          details: {
            replacedRevision: previous?.plan.revision ?? null,
            actor: `operator:${this.#options.operatorId}`,
          },
          value: { planHash: hash, version: mission.version },
        };
      },
    );
  }
  approvePlan(id: string, hash: string, expectedVersion: number, expiresAt: number, requestId: string): null {
    return this.#edit(
      id,
      requestId,
      { hash, expectedVersion, expiresAt, operator: this.#options.operatorId },
      'plan.approved',
      (mission, view, now) => {
        this.#version(mission, expectedVersion);
        ensure(hash === mission.planHash, 'APPROVAL_HASH_MISMATCH');
        ensure(
          Number.isSafeInteger(expiresAt) &&
            expiresAt > now &&
            expiresAt <= now + mission.plan.limits.deadlineMs,
          'APPROVAL_EXPIRY',
        );
        ensure(!['cancel_requested', 'canceled'].includes(mission.status), 'MISSION_CANCELED');
        const others = view.missions.filter(
          (item) =>
            item.id !== id &&
            item.approval &&
            !['canceled', 'awaiting_action_approval'].includes(item.status),
        );
        ensure(others.length < this.#policy.activeMissions, 'MISSION_CAPACITY');
        mission.approval = { hash, operator: this.#options.operatorId, expiresAt };
        mission.deadline = expiresAt;
        return null;
      },
    );
  }
  dispatch(requestId: string): Lease | null {
    const now = this.#time();
    return this.#ledger.transact(
      'factory:scheduler',
      requestId,
      digest({ kind: 'dispatch' }),
      now,
      (view): Change<Lease | null> => {
        const missions = structuredClone(view.missions);
        for (const mission of missions) refresh(mission, view.round);
        const candidates = missions.flatMap((mission) =>
          Object.values(mission.tasks)
            .filter((task) => claimable(mission, task, missions, this.#policy, now))
            .map((task) => ({
              mission,
              task,
              score: Math.min(3, task.priority + Math.floor((view.round - task.readyRound) / 2)),
            })),
        );
        candidates.sort(
          (a, b) =>
            b.score - a.score ||
            a.mission.lastScheduledRound - b.mission.lastScheduledRound ||
            a.mission.id.localeCompare(b.mission.id) ||
            a.task.spec.id.localeCompare(b.task.spec.id),
        );
        const selected = candidates[0];
        if (!selected) return { mission: null, kind: 'scheduler.idle', details: {}, value: null };
        const { mission, task } = selected;
        ensure(mission.dataEventCount < this.#policy.maxDataEvents, 'EVENT_BUDGET');
        const id = this.#id();
        ensure(
          !missions.some((item) =>
            Object.values(item.tasks).some((candidate) =>
              candidate.attempts.some((attempt) => attempt.id === id),
            ),
          ),
          'ATTEMPT_ID_COLLISION',
        );
        const token = this.#id();
        const round = view.round + 1;
        const inputs = Object.fromEntries(
          task.spec.dependencies.map((dependency) => {
            const predecessor = currentTask(mission, dependency.taskId);
            ensure(predecessor.outputDigest, 'DEPENDENCY_OUTPUT_MISSING');
            return [dependency.taskId, predecessor.outputDigest];
          }),
        );
        task.attempts.push({
          id,
          token,
          epoch: view.epoch,
          number: task.attempts.length + 1,
          hostId: 'fixture-local',
          providerId: 'fake',
          status: 'running',
          leaseUntil: Math.min(now + this.#policy.leaseMs, mission.deadline),
          nextSequence: 1,
          pending: [],
          outputDigest: null,
          reason: null,
          startedAt: now,
          endedAt: null,
          inputs,
        });
        task.status = 'running';
        task.reason = null;
        mission.lastScheduledRound = round;
        mission.dataEventCount++;
        mission.version++;
        const lease: Lease = {
          missionId: mission.id,
          taskId: task.spec.id,
          attemptId: id,
          token,
          planHash: mission.planHash,
          epoch: view.epoch,
        };
        return {
          mission,
          kind: 'attempt.claimed',
          details: { taskId: task.spec.id, attemptId: id, actor: 'supervisor:fixture-local' },
          value: lease,
          round,
        };
      },
    );
  }
  worker(lease: Lease) {
    const captured = structuredClone(lease);
    return Object.freeze({
      send: (value: unknown): null => this.#receive(captured, value),
      heartbeat: (requestId: string): null =>
        this.#edit(
          captured.missionId,
          requestId,
          captured,
          'attempt.heartbeat',
          (mission, _view, now) => {
            const { attempt } = this.#owned(mission, captured, now);
            ensure(mission.dataEventCount < this.#policy.maxDataEvents, 'EVENT_BUDGET');
            mission.dataEventCount++;
            attempt.leaseUntil = Math.min(now + this.#policy.leaseMs, mission.deadline);
            return null;
          },
          false,
          { producer: captured.attemptId },
        ),
      inbox: (cursor?: { ledgerId: string; after: number }) => {
        const snapshot = this.#ledger.snapshot();
        const mission = snapshot.missions.find((item) => item.id === captured.missionId);
        ensure(mission, 'UNKNOWN_MISSION');
        this.#owned(mission, captured, this.#time());
        const events = this.#ledger.events(cursor?.ledgerId ?? snapshot.ledgerId, cursor?.after ?? 0);
        const messages: Record<string, unknown>[] = [];
        for (const event of events)
          if (
            event.missionId === captured.missionId &&
            event.planHash === captured.planHash &&
            event.kind === 'worker.message'
          ) {
            const body = JSON.parse(event.payload) as { details: { delivered: Record<string, unknown>[] } };
            for (const message of body.details.delivered)
              if (message.recipientTaskId === captured.taskId)
                messages.push({ cursor: event.cursor, ...message });
          }
        return { ledgerId: snapshot.ledgerId, cursor: snapshot.cursor, messages };
      },
    });
  }
  #receive(lease: Lease, value: unknown): null {
    const envelope = envelopeInput(value);
    ensure(Buffer.byteLength(canonical(envelope)) <= 65536, 'MESSAGE_SIZE');
    ensure(
      envelope.missionId === lease.missionId &&
        envelope.taskId === lease.taskId &&
        envelope.attemptId === lease.attemptId &&
        envelope.token === lease.token &&
        envelope.planHash === lease.planHash,
      'MESSAGE_SCOPE',
    );
    const key = digest({ producer: lease.attemptId, sequence: envelope.sequence });
    const delivered: Record<string, unknown>[] = [];
    return this.#edit(
      lease.missionId,
      key,
      envelope,
      'worker.message',
      (mission, _view, now) => {
        const { task, attempt } = this.#owned(mission, lease, now);
        ensure(attempt.status === 'running', 'PRODUCER_ALREADY_COMPLETED');
        ensure(
          mission.communicationCount < this.#policy.maxMessages &&
            mission.dataEventCount < this.#policy.maxDataEvents,
          'MESSAGE_BUDGET',
        );
        ensure(envelope.sequence >= attempt.nextSequence, 'STALE_SEQUENCE');
        if (envelope.sequence > attempt.nextSequence) {
          ensure(
            attempt.pending.length < this.#policy.maxGap &&
              !attempt.pending.some((item) => item.sequence === envelope.sequence),
            'PRODUCER_GAP_BUDGET',
          );
          ensure(
            Buffer.byteLength(canonical([...attempt.pending, envelope])) <= this.#policy.maxGapBytes,
            'PRODUCER_GAP_BUDGET',
          );
          attempt.pending.push(envelope);
          attempt.pending.sort((a, b) => a.sequence - b.sequence);
          mission.dataEventCount++;
          return null;
        }
        const queue: Envelope[] = [envelope];
        while (queue.length) {
          const item = queue.shift();
          ensure(item, 'INTERNAL_QUEUE');
          const recipient = item.recipientTaskId
            ? currentTask(mission, item.recipientTaskId).spec.lab
            : 'headquarters';
          const message = {
            attemptId: attempt.id,
            taskId: task.spec.id,
            sender: task.spec.lab,
            receiver: recipient,
            recipientTaskId: item.recipientTaskId ?? null,
            sequence: item.sequence,
            kind: item.kind,
            text: item.text ?? '',
          };
          mission.communications.push(message);
          mission.communications = mission.communications.slice(-8);
          mission.communicationCount++;
          delivered.push(message);
          ensure(mission.communicationCount <= this.#policy.maxMessages, 'MESSAGE_BUDGET');
          if (item.kind === 'completed') {
            ensure(
              item.outputDigest && attempt.status === 'running' && attempt.pending.length === 0,
              'INVALID_COMPLETION',
            );
            attempt.outputDigest = item.outputDigest;
            attempt.status = 'reported';
          }
          if (item.kind === 'blocked') attempt.reason = item.text ?? 'worker_blocked';
          attempt.nextSequence++;
          const next = attempt.pending.findIndex((pending) => pending.sequence === attempt.nextSequence);
          if (next !== -1) queue.push(...attempt.pending.splice(next, 1));
        }
        mission.dataEventCount++;
        return null;
      },
      false,
      { delivered, producer: lease.attemptId },
    );
  }
  /** Trusted supervisor observation, separate from the worker's completion assertion. */
  confirmFinished(lease: Lease, outputDigest: string, requestId: string): null {
    return this.#edit(
      lease.missionId,
      requestId,
      { lease, outputDigest },
      'attempt.finished',
      (mission, _view, now) => {
        const { task, attempt } = this.#owned(mission, lease, now);
        ensure(attempt.status === 'reported' && attempt.outputDigest === outputDigest, 'OUTPUT_NOT_REPORTED');
        ensure(
          this.#options.verifyArtifact(lease, outputDigest, task.spec.lab),
          'OUTPUT_MISSING_OR_TAMPERED',
        );
        attempt.status = 'succeeded';
        attempt.endedAt = now;
        task.outputDigest = outputDigest;
        task.status = 'completed';
        return null;
      },
    );
  }
  recordEvidence(value: unknown, requestId: string): null {
    const evidence = evidenceInput(value);
    return this.#edit(
      evidence.missionId,
      requestId,
      evidence,
      'verification.recorded',
      (mission, _view, now) => {
        authorized(mission, now);
        ensure(evidence.planHash === mission.planHash, 'STALE_PLAN');
        const target = currentTask(mission, evidence.taskId);
        const source = Object.values(mission.tasks).find((task) =>
          task.attempts.some((attempt) => attempt.id === evidence.producingAttemptId),
        );
        ensure(
          source && source.spec.id !== target.spec.id && ['qa', 'security'].includes(source.spec.lab),
          'SELF_VERIFICATION',
        );
        ensure(
          source.spec.verifies.some(
            (item) => item.taskId === target.spec.id && item.checkId === evidence.checkId,
          ),
          'UNASSIGNED_VERIFIER',
        );
        const producer = latest(source);
        ensure(
          producer?.id === evidence.producingAttemptId &&
            producer.status === 'succeeded' &&
            producer.epoch === this.#ledger.epoch,
          'STALE_VERIFIER',
        );
        const attempt = latest(target);
        ensure(
          attempt?.id === evidence.attemptId &&
            attempt.status === 'succeeded' &&
            outputOf(target) === evidence.inputDigest,
          'STALE_EVIDENCE',
        );
        ensure(
          producer.inputs[target.spec.id] === evidence.inputDigest &&
            this.#options.verifyEvidence(evidence, source.spec.id),
          'UNVERIFIED_RECEIPT',
        );
        target.evidence.push(evidence);
        return null;
      },
    );
  }
  requestRework(id: string, taskId: string, requestId: string): null {
    return this.#edit(id, requestId, { taskId }, 'verification.rework', (mission, _view, now) => {
      authorized(mission, now);
      const target = currentTask(mission, taskId);
      ensure(
        target.status === 'completed' &&
          target.evidence.some(
            (item) => item.inputDigest === target.outputDigest && item.result === 'failed',
          ),
        'NO_FAILED_CHECK',
      );
      const ids = new Set([taskId]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const task of Object.values(mission.tasks))
          if (
            !ids.has(task.spec.id) &&
            task.spec.dependencies.some((dependency) => ids.has(dependency.taskId))
          ) {
            ids.add(task.spec.id);
            changed = true;
          }
      }
      const affected = [...ids].map((key) => currentTask(mission, key));
      for (const task of affected) {
        ensure(!task.attempts.some(held), 'REWORK_STILL_RUNNING');
        task.status = task.attempts.length < mission.plan.limits.attemptsPerTask ? 'pending' : 'blocked';
        task.reason = task.status === 'blocked' ? 'ATTEMPT_BUDGET' : 'verification_rework';
        task.outputDigest = null;
      }
      return null;
    });
  }
  cancelMission(id: string, expectedVersion: number, requestId: string): null {
    return this.#edit(
      id,
      requestId,
      { expectedVersion, operator: this.#options.operatorId },
      'mission.cancel_requested',
      (mission) => {
        this.#version(mission, expectedVersion);
        ensure(mission.status !== 'canceled', 'MISSION_CANCELED');
        mission.status = 'cancel_requested';
        for (const task of Object.values(mission.tasks)) {
          if (task.attempts.some(held)) task.status = 'cancel_requested';
          else if (task.status !== 'verified') task.status = 'canceled';
        }
        for (const action of mission.actions) action.revoked = true;
        return null;
      },
      true,
    );
  }
  cancelTask(id: string, taskId: string, expectedVersion: number, requestId: string): null {
    return this.#edit(
      id,
      requestId,
      { taskId, expectedVersion, operator: this.#options.operatorId },
      'task.cancel_requested',
      (mission) => {
        this.#version(mission, expectedVersion);
        currentTask(mission, taskId);
        const ids = new Set([taskId]);
        for (let changed = true; changed; ) {
          changed = false;
          for (const task of Object.values(mission.tasks))
            if (task.spec.parentId && ids.has(task.spec.parentId) && !ids.has(task.spec.id)) {
              ids.add(task.spec.id);
              changed = true;
            }
        }
        for (const key of ids) {
          const task = currentTask(mission, key);
          task.reason = 'task_cancel_requested';
          const attempt = latest(task);
          if (attempt && held(attempt)) {
            attempt.status = 'fenced';
            attempt.reason = 'task_cancel_requested';
            task.status = 'cancel_requested';
          } else task.status = 'canceled';
        }
        return null;
      },
      true,
    );
  }
  requestStop(lease: Lease, requestId: string): null {
    return this.#edit(
      lease.missionId,
      requestId,
      lease,
      'attempt.stop_requested',
      (mission, _view, now) => {
        const { attempt } = this.#owned(mission, lease, now, true);
        attempt.status = 'fenced';
        attempt.reason = 'supervisor_stop_requested';
        return null;
      },
      true,
    );
  }
  fenceExpired(id: string, requestId: string): null {
    return this.#edit(
      id,
      requestId,
      {},
      'attempts.fenced',
      (mission, _view, now) => {
        for (const task of activeTasks(mission)) {
          const attempt = latest(task);
          ensure(attempt, 'INTERNAL_ATTEMPT');
          if (attempt.leaseUntil <= now || attempt.epoch !== this.#ledger.epoch) {
            attempt.status = 'fenced';
            attempt.reason = 'lease_or_epoch_expired';
          }
        }
        return null;
      },
      true,
    );
  }
  confirmStopped(lease: Lease, requestId: string): null {
    return this.#edit(
      lease.missionId,
      requestId,
      lease,
      'attempt.stopped',
      (mission, _view, now) => {
        const { task, attempt } = this.#owned(mission, lease, now, true);
        ensure(
          mission.status === 'cancel_requested' || attempt.status === 'fenced' || attempt.leaseUntil <= now,
          'STOP_NOT_REQUESTED',
        );
        const canceled = mission.status === 'cancel_requested' || task.reason === 'task_cancel_requested';
        attempt.status = canceled ? 'canceled' : 'lost';
        attempt.endedAt = now;
        attempt.pending = [];
        task.status = canceled
          ? 'canceled'
          : task.attempts.length < mission.plan.limits.attemptsPerTask
            ? 'pending'
            : 'blocked';
        task.reason = task.status === 'blocked' ? 'ATTEMPT_BUDGET' : 'stopped';
        return null;
      },
      true,
    );
  }
  /** Fake jobs live in the confirmed-dead coordinator; no real worker takeover is qualified here. */
  recoverFake(id: string, requestId: string): null {
    return this.#edit(
      id,
      requestId,
      {},
      'coordinator.fake_recovery',
      (mission, _view, now) => {
        for (const task of activeTasks(mission)) {
          const attempt = latest(task);
          ensure(attempt && attempt.epoch < this.#ledger.epoch, 'OWNER_NOT_SUPERSEDED');
          const canceled = mission.status === 'cancel_requested' || task.reason === 'task_cancel_requested';
          attempt.status = canceled ? 'canceled' : 'lost';
          attempt.endedAt = now;
          attempt.pending = [];
          task.status = canceled
            ? 'canceled'
            : task.attempts.length < mission.plan.limits.attemptsPerTask
              ? 'pending'
              : 'blocked';
          task.reason = task.status === 'blocked' ? 'ATTEMPT_BUDGET' : 'coordinator_restart';
        }
        return null;
      },
      true,
    );
  }
  setPriority(
    id: string,
    taskId: string,
    priority: number,
    expectedVersion: number,
    requestId: string,
  ): null {
    return this.#edit(
      id,
      requestId,
      { taskId, priority, expectedVersion, operator: this.#options.operatorId },
      'task.priority_changed',
      (mission) => {
        this.#version(mission, expectedVersion);
        ensure(Number.isInteger(priority) && priority >= 0 && priority <= 3, 'PRIORITY_POLICY');
        currentTask(mission, taskId).priority = priority;
        return null;
      },
    );
  }
  approveAction(value: unknown, expectedVersion: number, requestId: string): null {
    const action = actionInput(value);
    return this.#edit(
      action.missionId,
      requestId,
      { action, expectedVersion, operator: this.#options.operatorId },
      'action.approved',
      (mission, _view, now) => {
        this.#version(mission, expectedVersion);
        ensure(mission.status === 'awaiting_action_approval', 'REQUIRED_GATES');
        authorized(mission, now);
        ensure(this.#intact(mission), 'EVIDENCE_MISSING_OR_TAMPERED');
        ensure(action.planHash === mission.planHash && action.expiresAt > now, 'ACTION_BINDING');
        ensure(!mission.actions.some((item) => item.action.id === action.id), 'ACTION_ID_USED');
        mission.actions.push({ action, operator: this.#options.operatorId, used: false, revoked: false });
        return null;
      },
    );
  }
  /** Validates one-use records for the qualification harness. There is deliberately no external executor. */
  consumeActionForSimulation(value: unknown, requestId: string): null {
    const action = actionInput(value);
    return this.#edit(action.missionId, requestId, action, 'action.simulated_use', (mission, _view, now) => {
      authorized(mission, now);
      ensure(mission.status === 'awaiting_action_approval', 'REQUIRED_GATES');
      ensure(this.#intact(mission), 'EVIDENCE_MISSING_OR_TAMPERED');
      const approval = mission.actions.find((item) => item.action.id === action.id);
      ensure(
        approval &&
          !approval.used &&
          !approval.revoked &&
          action.expiresAt > now &&
          action.planHash === mission.planHash &&
          digest(approval.action) === digest(action),
        'ACTION_BINDING',
      );
      approval.used = true;
      return null;
    });
  }
  inspect(id: string) {
    const snapshot = this.#ledger.snapshot();
    const mission = snapshot.missions.find((item) => item.id === id);
    ensure(mission, 'UNKNOWN_MISSION');
    const now = this.#time(true);
    return {
      ...mission,
      deliveryReady:
        mission.status === 'awaiting_action_approval' &&
        mission.approval !== null &&
        mission.approval.expiresAt > now &&
        this.#intact(mission),
      telemetryGaps: Object.values(mission.tasks).flatMap((task) =>
        task.attempts
          .filter((attempt) => attempt.pending.length > 0)
          .map((attempt) => ({
            taskId: task.spec.id,
            attemptId: attempt.id,
            expected: attempt.nextSequence,
            buffered: attempt.pending.map((item) => item.sequence),
          })),
      ),
      queue: Object.values(mission.tasks)
        .filter((task) => task.status === 'ready')
        .map((task) => {
          const reason =
            mission.dataEventCount >= this.#policy.maxDataEvents
              ? 'EVENT_BUDGET'
              : mission.deadline <= now
                ? 'MISSION_DEADLINE'
                : !mission.approval || mission.approval.expiresAt <= now
                  ? 'PLAN_APPROVAL_EXPIRED'
                  : task.attempts.length >= mission.plan.limits.attemptsPerTask
                    ? 'ATTEMPT_BUDGET'
                    : null;
          return {
            taskId: task.spec.id,
            reason,
            state: reason
              ? 'blocked'
              : claimable(mission, task, snapshot.missions, this.#policy, now)
                ? 'ready'
                : snapshot.missions.some((other) =>
                      activeTasks(other).some((holder) =>
                        holder.spec.resources.some((resource) =>
                          task.spec.resources.some(
                            (required) => mission.allocations[required] === other.allocations[resource],
                          ),
                        ),
                      ),
                    )
                  ? 'waiting_resource'
                  : 'waiting_capacity',
          };
        }),
      holders: activeTasks(mission).map((task) => ({
        taskId: task.spec.id,
        attemptId: latest(task)?.id,
        resources: task.spec.resources.map((resource) => mission.allocations[resource]),
      })),
    };
  }
  #intact(mission: Mission): boolean {
    return Object.values(mission.tasks).every((task) => {
      const attempt = latest(task);
      if (attempt?.status !== 'succeeded' || !task.outputDigest) return false;
      const lease: Lease = {
        missionId: mission.id,
        taskId: task.spec.id,
        attemptId: attempt.id,
        token: attempt.token,
        planHash: mission.planHash,
        epoch: attempt.epoch,
      };
      if (!this.#options.verifyArtifact(lease, task.outputDigest, task.spec.lab)) return false;
      if (
        !task.spec.dependencies.every((dependency) => {
          const predecessor = mission.tasks[dependency.taskId];
          return (
            predecessor !== undefined &&
            attempt.inputs[dependency.taskId] === predecessor.outputDigest &&
            (dependency.condition === 'verified'
              ? predecessor.status === 'verified'
              : ['completed', 'verified'].includes(predecessor.status))
          );
        })
      )
        return false;
      return task.spec.requiredChecks.every((checkId) => {
        const evidence = task.evidence.filter((item) => item.checkId === checkId).at(-1);
        if (
          evidence?.result !== 'passed' ||
          evidence.inputDigest !== task.outputDigest ||
          evidence.planHash !== mission.planHash
        )
          return false;
        const producer = Object.values(mission.tasks).find((candidate) =>
          candidate.attempts.some((item) => item.id === evidence.producingAttemptId),
        );
        return producer !== undefined && this.#options.verifyEvidence(evidence, producer.spec.id);
      });
    });
  }
}
