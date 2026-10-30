// SPDX-License-Identifier: Apache-2.0
import type { Action, Envelope, Evidence, Plan, TaskSpec } from '@asf/protocol';

export type AttemptStatus = 'running' | 'reported' | 'fenced' | 'succeeded' | 'failed' | 'canceled' | 'lost';
export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'cancel_requested'
  | 'completed'
  | 'verified'
  | 'blocked'
  | 'canceled';
export interface Attempt {
  id: string;
  token: string;
  epoch: number;
  number: number;
  hostId: string;
  providerId: string;
  status: AttemptStatus;
  leaseUntil: number;
  nextSequence: number;
  pending: Envelope[];
  outputDigest: string | null;
  reason: string | null;
  startedAt: number;
  endedAt: number | null;
  inputs: Record<string, string>;
}
export interface Task {
  spec: TaskSpec;
  status: TaskStatus;
  attempts: Attempt[];
  evidence: Evidence[];
  outputDigest: string | null;
  priority: number;
  readyRound: number;
  reason: string | null;
}
export interface ActionApproval {
  action: Action;
  operator: string;
  used: boolean;
  revoked: boolean;
}
export interface Communication {
  attemptId: string;
  taskId: string;
  sender: string;
  receiver: string;
  recipientTaskId: string | null;
  sequence: number;
  kind: Envelope['kind'];
  text: string;
}
export interface Mission {
  schemaVersion: 1;
  id: string;
  version: number;
  plan: Plan;
  planHash: string;
  approval: { hash: string; operator: string; expiresAt: number } | null;
  status:
    | 'awaiting_plan_approval'
    | 'running'
    | 'blocked'
    | 'cancel_requested'
    | 'canceled'
    | 'awaiting_action_approval';
  tasks: Record<string, Task>;
  allocations: Record<string, string>;
  actions: ActionApproval[];
  communications: Communication[];
  communicationCount: number;
  dataEventCount: number;
  createdAt: number;
  deadline: number;
  lastScheduledRound: number;
  reason: string | null;
}
export interface View {
  missions: Mission[];
  epoch: number;
  round: number;
}
export interface Change<T> {
  mission: Mission | null;
  kind: string;
  details: Record<string, unknown>;
  value: T;
  round?: number;
}
export interface JournalEvent {
  cursor: number;
  ledgerId: string;
  missionId: string;
  kind: string;
  planHash: string;
  at: number;
  previousHash: string;
  hash: string;
  payload: string;
}
export interface Snapshot {
  ledgerId: string;
  cursor: number;
  missions: Mission[];
  round: number;
}
export interface Ledger {
  readonly epoch: number;
  transact<T>(
    missionId: string,
    requestId: string,
    inputDigest: string,
    now: number,
    decide: (view: View) => Change<T>,
  ): T;
  read(missionId: string): Mission | undefined;
  all(): Mission[];
  snapshot(): Snapshot;
  events(ledgerId: string, after: number): JournalEvent[];
  close(): void;
}
export interface Policy {
  globalActive: number;
  hostActive: number;
  providerActive: number;
  missionActive: number;
  activeMissions: number;
  leaseMs: number;
  maxMessages: number;
  maxGap: number;
  maxGapBytes: number;
  maxDataEvents: number;
  capabilities: Readonly<Record<string, readonly string[]>>;
}
export const POLICY: Policy = {
  globalActive: 3,
  hostActive: 3,
  providerActive: 3,
  missionActive: 2,
  activeMissions: 2,
  leaseMs: 30_000,
  maxMessages: 100_000,
  maxGap: 256,
  maxGapBytes: 8192,
  maxDataEvents: 100_000,
  capabilities: {
    headquarters: ['fixture-read'],
    research: ['fixture-read'],
    architecture: ['fixture-read'],
    production: ['fixture-read', 'fixture-write'],
    qa: ['fixture-read', 'fixture-verify'],
    security: ['fixture-read', 'fixture-verify'],
    delivery: ['fixture-read'],
    operations: ['fixture-read'],
  },
};
for (const capabilities of Object.values(POLICY.capabilities)) Object.freeze(capabilities);
Object.freeze(POLICY.capabilities);
Object.freeze(POLICY);
export const held = (attempt: Attempt): boolean => ['running', 'reported', 'fenced'].includes(attempt.status);
export const latest = (task: Task): Attempt | undefined => task.attempts.at(-1);
export const activeTasks = (mission: Mission): Task[] =>
  Object.values(mission.tasks).filter((task) => task.attempts.some(held));
export const terminalTask = (task: Task): boolean => task.status === 'verified';
