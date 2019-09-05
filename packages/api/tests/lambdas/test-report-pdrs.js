'use strict';

const test = require('ava');

const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');

const Pdr = require('../../models/pdrs');
const { handler, getReportPdrMessages } = require('../../lambdas/report-pdrs');
const { fakePdrFactoryV2 } = require('../../lib/testUtils');
const { deconstructCollectionId } = require('../../lib/utils');

let executionName;
let pdrsModel;
let timestamp;

const createPdrMessage = ({
  cMetaParams = {},
  collectionId = `${randomId('MOD')}___${randomNumber()}`,
  completedExecutions = [],
  counter = 10,
  failedExecutions = [],
  isFinished = false,
  limit = 30,
  pdrParams,
  runningExecutions = [],
  status
} = {}) => ({
  cumulus_meta: {
    execution_name: executionName,
    state_machine: randomId('ingestPdr-'),
    workflow_start_time: timestamp,
    ...cMetaParams
  },
  meta: {
    collection: deconstructCollectionId(collectionId),
    provider: {
      id: 'prov1',
      protocol: 'http',
      host: 'example.com',
      port: 443
    },
    status
  },
  payload: {
    isFinished,
    completed: completedExecutions,
    counter,
    pdr: fakePdrFactoryV2(pdrParams),
    failed: failedExecutions,
    running: runningExecutions,
    limit
  }
});

const createPdrSnsMessage = (messageObject) => ({
  EventSource: 'aws:sns',
  Sns: {
    Message: JSON.stringify(messageObject)
  }
});

test.before(async () => {
  timestamp = Date.now() - randomNumber(10000000);
  process.env.PdrsTable = randomString();
  pdrsModel = new Pdr();
  await pdrsModel.createTable();
  executionName = randomString();
});

test.after.always(async () => {
  timestamp = undefined;
  await pdrsModel.deleteTable();
});

test('getReportPdrMessages returns correct number of messages', (t) => {
  let messages = getReportPdrMessages({
    Records: [{
      EventSource: 'aws:sns',
      Sns: {
        Message: JSON.stringify({
          cumulus_meta: {
            execution_name: 'exec123',
            state_machine: 'workflow123'
          },
          meta: {},
          payload: {}
        })
      }
    }]
  });
  t.is(messages.length, 1);

  messages = getReportPdrMessages({
    Records: [
      createPdrSnsMessage(createPdrMessage())
    ]
  });
  t.is(messages.length, 1);
});

test('handler correctly creates PDR record', async (t) => {
  const pdrName = randomString();
  const pdrParams = {
    name: pdrName
  };
  const status = 'running';

  await handler({
    Records: [
      createPdrSnsMessage(createPdrMessage({
        pdrParams,
        status
      }))
    ]
  });

  const record = await pdrsModel.get({ pdrName });
  t.is(typeof record.createdAt, 'number');
  t.is(record.createdAt, timestamp);
});

test('handler correctly updates PDR record', async (t) => {
  const pdrName = randomString();
  const pdrParams = {
    name: pdrName
  };
  const cMetaParams = {
    execution_name: randomString
  };
  let status = 'running';

  await handler({
    Records: [
      createPdrSnsMessage(createPdrMessage({
        pdrParams,
        status
      }))
    ]
  });
  const originalRecord = await pdrsModel.get({ pdrName });

  t.is(originalRecord.progress, 0);

  const newExecution = randomString();
  cMetaParams.execution_name = newExecution;
  status = 'completed';

  await handler({
    Records: [
      createPdrSnsMessage(createPdrMessage({
        collectionId: originalRecord.collectionId,
        pdrParams,
        cMetaParams,
        status,
        completedExecutions: [
          randomId('execution')
        ]
      }))
    ]
  });
  const updatedRecord = await pdrsModel.get({ pdrName });

  const expectedRecord = {
    ...originalRecord,
    stats: {
      ...originalRecord.stats,
      completed: 1,
      total: 1
    },
    progress: 100,
    status,
    duration: updatedRecord.duration,
    execution: updatedRecord.execution,
    updatedAt: updatedRecord.updatedAt,
    timestamp: updatedRecord.timestamp
  };

  t.deepEqual(expectedRecord, updatedRecord);
  t.true(updatedRecord.execution.includes(newExecution));
});
