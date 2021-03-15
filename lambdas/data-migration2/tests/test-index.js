const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Execution = require('@cumulus/api/models/executions');
const Granule = require('@cumulus/api/models/granules');
const Pdr = require('@cumulus/api/models/pdrs');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');

const { localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

let asyncOperationsModel;
let collectionsModel;
let executionsModel;
let granulesModel;
let pdrsModel;
let providersModel;
let rulesModel;

test.before(async () => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.GranulesTable = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.PdrsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };
  executionsModel = new Execution();
  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  collectionsModel = new Collection();
  granulesModel = new Granule();
  pdrsModel = new Pdr();
  providersModel = new Provider();
  rulesModel = new Rule();

  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await executionsModel.createTable();
  await granulesModel.createTable();
  await providersModel.createTable();
  await pdrsModel.createTable();
  await rulesModel.createTable();
});

test('handler migrates executions, granules, files, and PDRs', async (t) => {
  const call = await handler({});
  const expected = `
      Migration summary:
        Executions:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
        Granules:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
        Files:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records failed
        PDRs:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
    `;
  t.is(call, expected);
});
