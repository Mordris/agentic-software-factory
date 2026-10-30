// SPDX-License-Identifier: Apache-2.0
import { applyPatch } from '@asf/store-sqlite';
import { expect, it } from 'vitest';

it('rejects reserved keys and coercible non-string JSON path segments before writes or removals', () => {
  const before = { nested: { keep: 1 } };
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    for (const path of [[key], ['nested', key], [[key]], ['nested', [key]]]) {
      for (const remove of [false, true]) {
        const patches = JSON.parse(
          JSON.stringify([{ path, value: { injected: true }, ...(remove ? { remove: true } : {}) }]),
        );
        expect(() => applyPatch(before, patches)).toThrow('UNSAFE_PATCH');
        expect(Object.getPrototypeOf(before)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(before.nested)).toBe(Object.prototype);
        expect(Object.hasOwn(Object.prototype, 'injected')).toBe(false);
        expect(before).toEqual({ nested: { keep: 1 } });
      }
    }
  }
});

it('applies ordinary own-data writes/removals and snapshots path arrays before use', () => {
  const path = ['value'];
  Object.assign(path, { at: () => '__proto__', every: () => true, slice: () => ['constructor'] });
  const result = applyPatch({}, [{ path, value: { keep: true } }]);
  expect(result).toEqual({ value: { keep: true } });
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(applyPatch(result, [{ path: ['value', 'keep'], remove: true }])).toEqual({ value: {} });
  expect(applyPatch({}, [{ path: [''], value: 1 }])).toEqual({ '': 1 });
});
