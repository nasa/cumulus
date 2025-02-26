'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');

const fakeExecutionModule = {
  getExecution: ({ arn }) => Promise.resolve({
    originalPayload: {
      granules: [
        {
          files: [
            {
              name: `${arn.split('-').pop()}_id.nc`,
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
const TimeStampRegex = 'TIME_STAMP = \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.\\d{3}Z;\\n';
const longPanRegex = new RegExp(
  'MESSAGE_TYPE = "LONGPAN";\\n'
  + 'NO_OF_FILES = 5;\\n'
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "testA_id.nc";\\n'
  + 'DISPOSITION = "FAILED A";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "testB_id.nc";\\n'
  + 'DISPOSITION = "FAILED B";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "testC_id.nc";\\n'
  + 'DISPOSITION = "FAILED C";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "testD_id.nc";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "testE_id.nc";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
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
    { arn: 'arn:failed:execution-testA', reason: 'FAILED A' },
    { arn: 'arn:failed:execution-testB', reason: 'FAILED B' },
    { arn: 'arn:failed:execution-testC', reason: 'FAILED C' },
    'arn:completed:execution-testD',
    'arn:completed:execution-testE',
  ];
  const pan = await pdrHelpers.generateLongPAN(executions);
  t.regex(pan, longPanRegex);
});
