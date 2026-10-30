// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runDemo } from '../../apps/cli/dist/demo.js';

const root = resolve('.factory/evals');
const { mkdirSync } = await import('node:fs');
mkdirSync(root, { recursive: true, mode: 0o700 });
const state = mkdtempSync(join(root, 'two-mission-'));
const result = await runDemo(state);
writeFileSync(join(state, 'acceptance.json'), JSON.stringify({ state, ...result }, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify({
    state,
    simulation: true,
    ...result.observations,
    ownedCrash: result.ownedCrash,
    replayVerified: true,
    externalActions: result.externalActions,
  }),
);
