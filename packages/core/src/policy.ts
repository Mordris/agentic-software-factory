// SPDX-License-Identifier: Apache-2.0

import type { Plan } from '@asf/protocol';
import { ensure } from '@asf/protocol';
import { digest } from './hash.js';
import type { Mission, Policy, Task } from './model.js';
import { activeTasks, latest, terminalTask } from './model.js';

export function validateGraph(plan: Plan, policy: Policy): void {
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  const allocations = new Set(plan.allocations.map((item) => item.id));
  const visited = new Set<string>();
  ensure(tasks.size === plan.tasks.length && allocations.size === plan.allocations.length, 'DUPLICATE_ID');
  const visit = (id: string, path: Set<string>): void => {
    ensure(!path.has(id), 'DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    const task = tasks.get(id);
    ensure(task, 'MISSING_DEPENDENCY');
    const next = new Set([...path, id]);
    for (const dependency of task.dependencies) visit(dependency.taskId, next);
    visited.add(id);
  };
  for (const task of plan.tasks) {
    ensure(
      task.capabilities.every((capability) => policy.capabilities[task.lab]?.includes(capability)),
      'UNSUPPORTED_CAPABILITY',
    );
    ensure(
      task.resources.every((resource) => allocations.has(resource)),
      'UNALLOCATED_RESOURCE',
    );
    ensure(
      new Set(task.dependencies.map((item) => item.taskId)).size === task.dependencies.length,
      'DUPLICATE_DEPENDENCY',
    );
    visit(task.id, new Set());
    let parent = task.parentId;
    const seen = new Set([task.id]);
    let depth = 0;
    while (parent !== undefined) {
      ensure(!seen.has(parent), 'PARENT_CYCLE');
      seen.add(parent);
      depth++;
      ensure(depth <= plan.limits.depth, 'DEPTH_BUDGET');
      const ancestor = tasks.get(parent);
      ensure(ancestor, 'MISSING_PARENT');
      ensure(
        task.resources.every((resource) => ancestor.resources.includes(resource)),
        'DESCENDANT_SCOPE',
      );
      parent = ancestor.parentId;
    }
    ensure(
      plan.tasks.filter((child) => child.parentId === task.id).length <= plan.limits.fanOut,
      'FAN_OUT_BUDGET',
    );
    for (const target of task.verifies) {
      ensure(['qa', 'security'].includes(task.lab) && task.id !== target.taskId, 'SELF_VERIFICATION');
      ensure(tasks.get(target.taskId)?.requiredChecks.includes(target.checkId), 'UNKNOWN_CHECK');
      ensure(
        task.dependencies.some(
          (dependency) => dependency.taskId === target.taskId && dependency.condition === 'completed',
        ),
        'VERIFIER_INPUT_DEPENDENCY',
      );
    }
    for (const checkId of task.requiredChecks) {
      ensure(
        plan.tasks.some((candidate) =>
          candidate.verifies.some((target) => target.taskId === task.id && target.checkId === checkId),
        ),
        'MISSING_VERIFIER',
      );
    }
  }
}

export function refresh(mission: Mission, round: number): void {
  if (mission.status === 'cancel_requested' || mission.status === 'canceled') {
    if (activeTasks(mission).length === 0) {
      mission.status = 'canceled';
      for (const task of Object.values(mission.tasks)) if (!terminalTask(task)) task.status = 'canceled';
    }
    return;
  }
  if (!mission.approval || mission.approval.hash !== mission.planHash) {
    mission.status = 'awaiting_plan_approval';
    return;
  }
  for (const task of Object.values(mission.tasks)) {
    if (task.status === 'completed' || task.status === 'verified') {
      task.status = task.spec.requiredChecks.every((checkId) => {
        const check = task.evidence.filter((item) => item.checkId === checkId).at(-1);
        return (
          check?.result === 'passed' &&
          check.inputDigest === task.outputDigest &&
          check.planHash === mission.planHash
        );
      })
        ? 'verified'
        : 'completed';
    }
  }
  for (const task of Object.values(mission.tasks)) {
    if (task.status !== 'pending' && task.status !== 'ready') continue;
    const ready = task.spec.dependencies.every((dependency) => {
      const predecessor = mission.tasks[dependency.taskId];
      return (
        predecessor !== undefined &&
        (dependency.condition === 'verified'
          ? predecessor.status === 'verified'
          : ['completed', 'verified'].includes(predecessor.status))
      );
    });
    if (ready && task.status === 'pending') {
      task.status = 'ready';
      task.readyRound = round;
    } else if (!ready) task.status = 'pending';
  }
  if (Object.values(mission.tasks).every(terminalTask)) mission.status = 'awaiting_action_approval';
  else if (
    Object.values(mission.tasks).some((task) => task.status === 'blocked' || task.status === 'canceled') &&
    activeTasks(mission).length === 0 &&
    !Object.values(mission.tasks).some((task) => task.status === 'ready')
  )
    mission.status = 'blocked';
  else mission.status = 'running';
}

export function currentTask(mission: Mission, taskId: string): Task {
  const task = Object.hasOwn(mission.tasks, taskId) ? mission.tasks[taskId] : undefined;
  ensure(task, 'UNKNOWN_TASK');
  return task;
}

export function authorized(mission: Mission, now: number): void {
  ensure(mission.approval?.hash === mission.planHash, 'PLAN_NOT_APPROVED');
  ensure(mission.approval.expiresAt > now, 'PLAN_APPROVAL_EXPIRED');
  ensure(mission.deadline > now, 'MISSION_DEADLINE');
  ensure(
    !['cancel_requested', 'canceled', 'blocked', 'awaiting_plan_approval'].includes(mission.status),
    'MISSION_NOT_RUNNABLE',
  );
}

export function claimable(
  mission: Mission,
  task: Task,
  missions: Mission[],
  policy: Policy,
  now: number,
): boolean {
  if (
    mission.status !== 'running' ||
    mission.approval?.hash !== mission.planHash ||
    mission.approval.expiresAt <= now ||
    mission.deadline <= now
  )
    return false;
  if (mission.dataEventCount >= policy.maxDataEvents) return false;
  if (task.status !== 'ready' || task.attempts.length >= mission.plan.limits.attemptsPerTask) return false;
  const allHeld = missions.flatMap((item) => activeTasks(item));
  const count = Math.min(policy.globalActive, policy.hostActive, policy.providerActive);
  if (
    allHeld.length >= count ||
    activeTasks(mission).length >= Math.min(policy.missionActive, mission.plan.limits.active)
  )
    return false;
  const required = new Set(task.spec.resources.map((resource) => mission.allocations[resource]));
  return !missions.some((other) =>
    activeTasks(other).some((holder) =>
      holder.spec.resources.some((resource) => required.has(other.allocations[resource])),
    ),
  );
}

export const planHash = (plan: Plan): string => digest({ domain: 'asf-plan-v1', plan });
export function outputOf(task: Task): string {
  const attempt = latest(task);
  ensure(attempt?.status === 'succeeded' && attempt.outputDigest, 'OUTPUT_NOT_CONFIRMED');
  return attempt.outputDigest;
}
