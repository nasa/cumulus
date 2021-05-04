const test = require('ava');

const {
  isRecordDefined,
} = require('../dist/database');

test('isRecordDefined correctly returns true', async (t) => {
  t.true(isRecordDefined({ info: 'value' }));
});

test('isRecordDefined correctly returns false', async (t) => {
  t.false(isRecordDefined(undefined));
});
