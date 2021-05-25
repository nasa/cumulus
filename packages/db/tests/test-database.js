const test = require('ava');

const {
  isRecordDefined,
} = require('../dist/database');

test('isRecordDefined correctly returns true', (t) => {
  t.true(isRecordDefined({ info: 'value' }));
});

test('isRecordDefined correctly returns false', (t) => {
  t.false(isRecordDefined(undefined));
});
