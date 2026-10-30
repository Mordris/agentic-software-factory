// SPDX-License-Identifier: Apache-2.0

import { Ajv } from 'ajv';
import Type from 'typebox';

const schema = Type.Object(
  { task: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);
type Input = Type.Static<typeof schema>;
const input: Input = { task: 'qualify-json-boundary' };
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validate = ajv.compile(schema);
if (!validate(input) || validate({ task: 4 }) || validate({ task: 'valid', approved: true })) {
  throw new Error('Schema/static-type/runtime boundary qualification failed');
}
console.log(
  JSON.stringify({ qualification: 'typescript-typebox-ajv', result: 'passed', node: process.version }),
);
