// SPDX-License-Identifier: Apache-2.0
import { Ajv } from 'ajv';
import Type from 'typebox';

export const VERSION = 1;
export const LABS = [
  'headquarters',
  'research',
  'architecture',
  'production',
  'qa',
  'security',
  'delivery',
  'operations',
] as const;
export const Id = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: '^(?!(?:constructor|prototype|__proto__)$)[a-zA-Z0-9][a-zA-Z0-9_-]*$',
});
export const Digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
// Preserve a tuple: TypeBox's static union reduces an unconstrained array to never.
export const Lab = Type.Union([
  Type.Literal('headquarters'),
  Type.Literal('research'),
  Type.Literal('architecture'),
  Type.Literal('production'),
  Type.Literal('qa'),
  Type.Literal('security'),
  Type.Literal('delivery'),
  Type.Literal('operations'),
]);
const Count = (maximum: number) => Type.Integer({ minimum: 1, maximum });
const Dependency = Type.Object(
  { taskId: Id, condition: Type.Union([Type.Literal('completed'), Type.Literal('verified')]) },
  { additionalProperties: false },
);
const VerificationTarget = Type.Object({ taskId: Id, checkId: Id }, { additionalProperties: false });
export const TaskSchema = Type.Object(
  {
    id: Id,
    lab: Lab,
    capabilities: Type.Array(Id, { minItems: 1, maxItems: 8, uniqueItems: true }),
    dependencies: Type.Array(Dependency, { maxItems: 64 }),
    resources: Type.Array(Id, { maxItems: 8, uniqueItems: true }),
    requiredChecks: Type.Array(Id, { maxItems: 16, uniqueItems: true }),
    verifies: Type.Array(VerificationTarget, { maxItems: 16 }),
    parentId: Type.Optional(Id),
    priority: Type.Integer({ minimum: 0, maximum: 3 }),
    acceptance: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 8 }),
  },
  { additionalProperties: false },
);
export const PlanSchema = Type.Object(
  {
    schemaVersion: Type.Literal(VERSION),
    missionId: Id,
    revision: Count(1_000_000),
    repositoryId: Id,
    snapshot: Digest,
    allocations: Type.Array(
      Type.Object(
        { id: Id, path: Type.String({ minLength: 1, maxLength: 300 }) },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    tasks: Type.Array(TaskSchema, { minItems: 1, maxItems: 64 }),
    limits: Type.Object(
      {
        active: Count(2),
        attemptsPerTask: Count(2),
        fanOut: Count(4),
        depth: Type.Integer({ minimum: 0, maximum: 2 }),
        deadlineMs: Count(3_600_000),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const EnvelopeSchema = Type.Object(
  {
    schemaVersion: Type.Literal(VERSION),
    missionId: Id,
    taskId: Id,
    attemptId: Id,
    planHash: Digest,
    token: Id,
    sequence: Count(1_000_000),
    kind: Type.Union([
      Type.Literal('accepted'),
      Type.Literal('finding'),
      Type.Literal('question'),
      Type.Literal('blocked'),
      Type.Literal('completed'),
      Type.Literal('canceled'),
    ]),
    text: Type.Optional(Type.String({ maxLength: 4096 })),
    recipientTaskId: Type.Optional(Id),
    outputDigest: Type.Optional(Digest),
  },
  { additionalProperties: false },
);
export const EvidenceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(VERSION),
    missionId: Id,
    taskId: Id,
    attemptId: Id,
    producingAttemptId: Id,
    planHash: Digest,
    checkId: Id,
    inputDigest: Digest,
    environmentDigest: Digest,
    artifactDigest: Digest,
    result: Type.Union([
      Type.Literal('passed'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
      Type.Literal('canceled'),
      Type.Literal('blocked'),
      Type.Literal('inconclusive'),
    ]),
    invocation: Type.Object(
      {
        kind: Type.Literal('fixture-function'),
        identifier: Id,
        arguments: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 16 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const ActionSchema = Type.Object(
  {
    id: Id,
    missionId: Id,
    planHash: Digest,
    type: Type.Union([
      Type.Literal('push'),
      Type.Literal('pr'),
      Type.Literal('message'),
      Type.Literal('deploy'),
    ]),
    destination: Type.String({ minLength: 1, maxLength: 512 }),
    payloadDigest: Digest,
    expectedState: Digest,
    expiresAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
export type Plan = Type.Static<typeof PlanSchema>;
export type TaskSpec = Type.Static<typeof TaskSchema>;
export type Envelope = Type.Static<typeof EnvelopeSchema>;
export type Evidence = Type.Static<typeof EvidenceSchema>;
export type Action = Type.Static<typeof ActionSchema>;
export type LabId = (typeof LABS)[number];
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class FactoryError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'FactoryError';
  }
}
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new FactoryError(code);
}
const validator = new Ajv({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validatePlan = validator.compile<Plan>(PlanSchema);
const validateEnvelope = validator.compile<Envelope>(EnvelopeSchema);
const validateEvidence = validator.compile<Evidence>(EvidenceSchema);
const validateAction = validator.compile<Action>(ActionSchema);
export function planInput(value: unknown): Plan {
  ensure(validatePlan(value), 'INVALID_PLAN');
  return structuredClone(value);
}
export function envelopeInput(value: unknown): Envelope {
  ensure(validateEnvelope(value), 'INVALID_ENVELOPE');
  return structuredClone(value);
}
export function evidenceInput(value: unknown): Evidence {
  ensure(validateEvidence(value), 'INVALID_EVIDENCE');
  return structuredClone(value);
}
export function actionInput(value: unknown): Action {
  ensure(validateAction(value), 'INVALID_ACTION');
  return structuredClone(value);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    ensure(Number.isSafeInteger(value), 'UNSUPPORTED_NUMBER');
    return String(value === 0 ? 0 : value);
  }
  if (Array.isArray(value)) {
    ensure(
      value.every((_, index) => Object.hasOwn(value, index)) && Object.keys(value).length === value.length,
      'UNSUPPORTED_ARRAY',
    );
    return `[${Array.from(value, canonical).join(',')}]`;
  }
  ensure(typeof value === 'object' && value !== null, 'UNSUPPORTED_JSON');
  ensure([null, Object.prototype].includes(Object.getPrototypeOf(value)), 'UNSUPPORTED_OBJECT');
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',') +
    '}'
  );
}

/** Bounded JSON with duplicate decoded keys rejected before schema validation. */
export function parseJson(source: string): Json {
  ensure(new TextEncoder().encode(source).byteLength <= 65536, 'INPUT_TOO_LARGE');
  let index = 0;
  function whitespace() {
    while (/[ \t\r\n]/.test(source[index] ?? '') && index < source.length) index++;
  }
  function string(): string {
    const start = index++;
    while (index < source.length) {
      const character = source[index++];
      if (character === '\\') {
        index++;
        continue;
      }
      if (character === '"') return JSON.parse(source.slice(start, index)) as string;
    }
    throw new FactoryError('INVALID_JSON');
  }
  function value(depth: number): Json {
    ensure(depth <= 32, 'INPUT_TOO_DEEP');
    whitespace();
    const character = source[index];
    if (character === '"') return string();
    if (character === '{') {
      index++;
      whitespace();
      const object: Record<string, Json> = Object.create(null) as Record<string, Json>;
      if (source[index] === '}') {
        index++;
        return object;
      }
      while (index < source.length) {
        whitespace();
        ensure(source[index] === '"', 'INVALID_JSON');
        const key = string();
        whitespace();
        ensure(!Object.hasOwn(object, key), 'DUPLICATE_JSON_KEY');
        ensure(source[index++] === ':', 'INVALID_JSON');
        object[key] = value(depth + 1);
        whitespace();
        const delimiter = source[index++];
        if (delimiter === '}') return object;
        ensure(delimiter === ',', 'INVALID_JSON');
      }
    } else if (character === '[') {
      index++;
      whitespace();
      const array: Json[] = [];
      if (source[index] === ']') {
        index++;
        return array;
      }
      while (index < source.length) {
        ensure(array.length < 4096, 'INPUT_TOO_MANY_ITEMS');
        array.push(value(depth + 1));
        whitespace();
        const delimiter = source[index++];
        if (delimiter === ']') return array;
        ensure(delimiter === ',', 'INVALID_JSON');
      }
    } else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(index),
      )?.[0];
      ensure(token, 'INVALID_JSON');
      index += token.length;
      const parsed: unknown = JSON.parse(token);
      ensure(typeof parsed !== 'number' || Number.isSafeInteger(parsed), 'UNSUPPORTED_NUMBER');
      return parsed as Json;
    }
    throw new FactoryError('INVALID_JSON');
  }
  try {
    const result = value(0);
    whitespace();
    ensure(index === source.length, 'INVALID_JSON');
    return result;
  } catch (error) {
    if (error instanceof FactoryError) throw error;
    throw new FactoryError('INVALID_JSON');
  }
}
