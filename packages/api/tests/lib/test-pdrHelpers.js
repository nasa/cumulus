'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const { CumulusApiClientError } = require('@cumulus/api-client/CumulusApiClientError');

const fakeExecutionModule = {
  getExecution: ({ arn }) => {
    switch (arn) {
    case 'arn:completed:execution': {
      return Promise.resolve({
        originalPayload: {
          granules: [
            {
              files: [
                {
                  name: 'test_completed_id.nc',
                  path: 'test',
                },
                {
                  name: 'test_completed_id.nc.met',
                  path: 'test',
                },
              ],
              granuleId: 'test_id',
            },
          ],
        },
      });
    }
    case 'arn:completed:multiple:granules:execution': {
      return Promise.resolve({
        originalPayload: {
          granules: [
            {
              files: [
                {
                  name: 'test_multiple_id.nc',
                  path: 'test',
                },
                {
                  name: 'test_multiple_id.nc.met',
                  path: 'test',
                },
              ],
              granuleId: 'test_id',
            },
            {
              files: [
                {
                  name: 'test_multiple_id_1.nc',
                  path: 'test',
                },
                {
                  name: 'test_multiple_id_1.nc.met',
                  path: 'test',
                },
              ],
              granuleId: 'test_id_1',
            },
          ],
        },
      });
    }
    case 'arn:failed:execution-A':
    case 'arn:failed:execution-B': {
      const testCase = arn.split('-').pop();
      return Promise.resolve({
        originalPayload: {
          granules: [
            {
              files: [
                {
                  name: `test_${testCase}_id_failed.nc`,
                  path: 'test',
                },
                {
                  name: `test_${testCase}_id_failed.nc.met`,
                  path: 'test',
                },
              ],
              granuleId: `test_${testCase}_id_failed`,
            },
          ],
        },
      });
    }
    default: {
      throw new CumulusApiClientError('Test Error');
    }
    }
  },
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
  + 'MESSAGE_TYPE = "LONGPAN";\\n'
  + 'NO_OF_FILES = 10;\\n'
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_A_id_failed.nc";\\n'
  + 'DISPOSITION = "FAILED A";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_A_id_failed.nc.met";\\n'
  + 'DISPOSITION = "FAILED A";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_B_id_failed.nc";\\n'
  + 'DISPOSITION = "FAILED B";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_B_id_failed.nc.met";\\n'
  + 'DISPOSITION = "FAILED B";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_completed_id.nc";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_completed_id.nc.met";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_multiple_id.nc";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_multiple_id.nc.met";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_multiple_id_1.nc";\\n'
  + 'DISPOSITION = "SUCCESSFUL";\\n'
  + `${TimeStampRegex}`
  + 'FILE_DIRECTORY = "test";\\n'
  + 'FILE_NAME = "test_multiple_id_1.nc.met";\\n'
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
    { arn: 'arn:failed:executionA', reason: 'FAILED A' },
    { arn: 'arn:failed:executionB', reason: 'FAILED B' },
    'arn:completed:execution',
    'arn:completed:multiple:granules:execution',
  ];
  const pan = await pdrHelpers.generateLongPAN(executions);
  t.regex(pan, longPanRegex);
});
