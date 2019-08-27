'use strict';

const test = require('ava');

const Pdr = require('@cumulus/api/models/pdrs');
const { fakePdrFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');
const { randomId, randomString, randomNumber } = require('@cumulus/common/test-utils');
const { getSnsEventMessageObject } = require('@cumulus/common/sns-event');
const { handler, getReportGranuleMessages } = require('..');

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

test('getReportGranuleMessages returns no messages for non-SNS events', (t) => {
  let messages = getReportGranuleMessages({});
  t.is(messages.length, 0);

  messages = getReportGranuleMessages({
    Records: [{
      Sns: {}
    }]
  });
  t.is(messages.length, 0);

  messages = getReportGranuleMessages({
    Records: [{
      EventSource: 'aws:cloudwatch',
      CloudWatch: {
        Message: 'message'
      }
    }]
  });
  t.is(messages.length, 0);

  messages = getReportGranuleMessages({
    Records: [{
      EventSource: 'aws:states',
      States: {
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
  t.is(messages.length, 0);
});

test('getReportExecutionMessages returns correct number of messages', (t) => {
  let messages = getReportGranuleMessages({
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
  t.is(messages[0].payload.granules, undefined);

  messages = getReportGranuleMessages({
    Records: [
      createPdrSnsMessage(createPdrMessage({ numberOfGranules: 4 }))
    ]
  });
  t.is(messages.length, 1);
  t.is(messages[0].payload.granules.length, 4);

  messages = getReportGranuleMessages({
    Records: [
      createPdrSnsMessage(createPdrMessage()),
      createPdrSnsMessage(createPdrMessage()),
      createPdrSnsMessage(createPdrMessage())
    ]
  });
  t.is(messages.length, 3);
});

test('handler correctly ignores non-granule message', async (t) => {
  const response = await handler({
    Records: [{
      EventSource: 'aws:states',
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
  t.deepEqual(response, []);
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
  t.is(record.pdrName, pdrName);
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
    status: 'completed',
    duration: updatedRecord.duration,
    execution: updatedRecord.execution,
    updatedAt: updatedRecord.updatedAt,
    timestamp: updatedRecord.timestamp
  };

  t.deepEqual(expectedRecord, updatedRecord);
  t.true(updatedRecord.execution.includes(newExecution));
});

test('handler correctly creates multiple granule records from multi-granule message', async (t) => {
  const event = createPdrSnsMessage(createPdrMessage(
    { numberOfGranules: 3 }
  ));
  const granules = getSnsEventMessageObject(event).payload.granules;
  const granuleIds = granules.map((g) => g.granuleId);
  t.is(granuleIds.length, [...new Set(granuleIds)].length);
  await handler({
    Records: [
      event
    ]
  });
  await Promise.all(granules.map(async (g) => {
    const record = await pdrsModel.get({ granuleId: g.granuleId });
    t.deepEqual(g.files, record.files);
    t.is(g.collectionId, record.collectionId);
    t.is(g.status, record.status);
    t.is(g.published, record.published);
    t.is(g.cmrLink, record.cmrLink);
    t.is(typeof record.createdAt, 'number');
    t.is(record.createdAt, timestamp);
  }));
});

test('handler correctly updates multiple granule records from multi-granule message', async (t) => {
  const event = createPdrSnsMessage(createPdrMessage(
    { numberOfGranules: 3 }
  ));
  const msgObj = getSnsEventMessageObject(event);
  const granuleIds = msgObj.payload.granules.map((g) => g.granuleId);
  t.is(granuleIds.length, [...new Set(granuleIds)].length);
  await handler({
    Records: [
      event
    ]
  });
  msgObj.payload.granules.forEach((g) => {
    g.cmrLink = `http://newcmrlink.com/${g.granuleId}`;
  });
  event.Sns.Message = JSON.stringify(msgObj);
  await handler({
    Records: [
      event
    ]
  });
  await Promise.all(granuleIds.map(async (gid) => {
    const record = await pdrsModel.get({ granuleId: gid });
    t.is(record.cmrLink, `http://newcmrlink.com/${gid}`);
  }));
});
