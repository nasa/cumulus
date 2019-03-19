'use strict';

const fs = require('fs');
const path = require('path');
const test = require('ava');
const { promisify } = require('util');

const {
  validateConfig, validateInput, validateOutput
} = require('@cumulus/common/test-utils');
const { filesToGranules } = require('..');
const readFile = promisify(fs.readFile);

async function loadDataJSON(filename) {
  const payloadPath = path.join(__dirname, 'data', filename);
  const rawPayload = await readFile(payloadPath, 'utf8');
  return JSON.parse(rawPayload);
}

test.beforeEach(async (t) => {
  t.context.payload = await loadDataJSON('payload.json');
  t.context.output = await loadDataJSON('output.json');
});

test('files-to-granules transforms files array to granules object', async (t) => {
  const event = t.context.payload;
  await validateConfig(t, event.config);
  await validateInput(t, event.input);
  const expectedOutput = t.context.output;
  const output = filesToGranules(event);
  await validateOutput(t, output);
  t.deepEqual(output, expectedOutput);
});
