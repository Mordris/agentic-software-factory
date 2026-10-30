// SPDX-License-Identifier: Apache-2.0

import { digest, POLICY, validateGraph } from '@asf/core';
import { canonical, parseJson, planInput } from '@asf/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { plan, task } from './helpers.js';

describe('P1-05 bounded versioned protocol and hashing', () => {
  it('rejects decoded duplicate keys, invalid/trailing JSON, prototype IDs, unbounded depth, unsafe numbers and bytes', () => {
    for (const value of [
      '{"a":1,"\\u0061":2}',
      '[1,]',
      '{"a":}',
      '00',
      '1 false',
      '\u00a0null',
      '9007199254740992',
      '1e500',
      `${'['.repeat(34)}0${']'.repeat(34)}`,
      `"${'a'.repeat(65536)}"`,
    ])
      expect(() => parseJson(value)).toThrow();
    expect(() => planInput({ ...plan(), schemaVersion: 2 })).toThrow('INVALID_PLAN');
    expect(() => planInput({ ...plan(), missionId: 'constructor' })).toThrow('INVALID_PLAN');
    expect(() => planInput({ ...plan(), approved: true })).toThrow('INVALID_PLAN');
  });
  it('canonicalizes JSON key order without collapsing sparse arrays or unsupported values', () => {
    expect(digest({ b: [true, 3], a: 'x' })).toEqual(digest({ a: 'x', b: [true, 3] }));
    for (const value of [undefined, new Date(), NaN, Infinity, 0.5, new Array(1)])
      expect(() => canonical(value)).toThrow();
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        const source = JSON.stringify(value);
        if (source.length > 30000 || /\d\.\d|[eE][+-]?\d/.test(source)) return;
        try {
          expect(JSON.stringify(parseJson(source))).toBe(JSON.stringify(value));
        } catch (error) {
          expect(String(error)).toContain('UNSUPPORTED_NUMBER');
        }
      }),
      { numRuns: 100, seed: 20261030 },
    );
  });
  it('rejects dependency/delegation cycles, unavailable capabilities and unchecked verification loops', () => {
    const mutations = [
      plan('x', [task('a', { dependencies: [{ taskId: 'a', condition: 'verified' }] })]),
      plan('x', [task('a', { dependencies: [{ taskId: 'missing', condition: 'completed' }] })]),
      plan('x', [task('a', { parentId: 'a' })]),
      plan('x', [task('a', { capabilities: ['publish'] })]),
      plan('x', [task('a', { requiredChecks: ['missing'] })]),
    ];
    for (const value of mutations) expect(() => validateGraph(value, POLICY)).toThrow();
    const dense = plan(
      'dense',
      Array.from({ length: 64 }, (_, index) =>
        task(`task-${index}`, {
          dependencies: Array.from({ length: index }, (__, before) => ({
            taskId: `task-${before}`,
            condition: 'verified' as const,
          })),
        }),
      ),
    );
    expect(() => validateGraph(dense, POLICY)).not.toThrow();
  });
});
