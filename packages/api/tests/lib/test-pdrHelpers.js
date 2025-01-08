'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

const fakeExecutionModule = {
  getExecution: () => Promise.resolve({
    originalPayload: {
      granules: [
        {
          files: [
            {
              name: 'test_id.nc',
              path: 'test',
            },
          ],
          granuleId: 'test_id',
        },
      ],
    },
  }),
};

const pdrHelpers = proxyquire(
  '../../lib/pdrHelpers',
  {
    '@cumulus/api-client/executions': fakeExecutionModule,
  }
);

// eslint-disable-next-line max-len
const regex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "SUCCESSFUL";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;
// eslint-disable-next-line max-len
const emptyRegex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;
const longPanRegex = new RegExp(
  'MESSAGE_TYPE = "LONGPAN";\\n' +
  'NO_OF_FILES = 5;\\n' +
  'FILE_DIRECTORY = "test";\\n' +
  'FILE_NAME = "test_id";\\n' +
  'DISPOSITION = "FAILED A";\\n' +
  'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n' +
  'FILE_DIRECTORY = "test";\\n' +
  'FILE_NAME = "test_id";\\n' +
  'DISPOSITION = "FAILED B";\\n' +
  'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n' +
  'FILE_DIRECTORY = "test";\\n' +
  'FILE_NAME = "test_id";\\n' +
  'DISPOSITION = "FAILED C";\\n' +
  'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n' +
  'FILE_DIRECTORY = "test";\\n' +
  'FILE_NAME = "test_id";\\n' +
  'DISPOSITION = "SUCCESSFUL";\\n' +
  'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n' +
  'FILE_DIRECTORY = "test";\\n' +
  'FILE_NAME = "test_id";\\n' +
  'DISPOSITION = "SUCCESSFUL";\\n' +
  'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n'
);

test('generateShortPAN with a disposition', (t) => {
  const disposition = 'SUCCESSFUL';
  const pan = pdrHelpers.generateShortPAN(disposition);
  t.regex(pan, regex);
});

test('generateShortPAN with an empty disposition', (t) => {
  const disposition = '';
  const pan = pdrHelpers.generateShortPAN(disposition);
  t.regex(pan, emptyRegex);
});

test('generateLongPAN', async (t) => {
  const executions = [
    { arn: 'arn:failed:execution', reason: 'FAILED A' },
    { arn: 'arn:failed:execution', reason: 'FAILED B' },
    { arn: 'arn:failed:execution', reason: 'FAILED C' },
    'arn:completed:execution',
    'arn:completed:execution',
  ];
  const pan = await pdrHelpers.generateLongPAN(executions);
  t.regex(pan, longPanRegex);
});
