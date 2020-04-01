'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');

const {
  validateConfig, validateInput, validateOutput
} = require('@cumulus/common/test-utils');
const { filesToGranules } = require('..');

const loadDataJSON = (filename) =>
  fs.readJson(path.join(__dirname, 'data', filename));

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
