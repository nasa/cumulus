const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const KMS = require('@cumulus/aws-client/KMS');

const { localStackConnectionEnv } = require('@cumulus/db');
const { handler } = require('../dist/lambda');

let asyncOperationsModel;
let collectionsModel;
let providersModel;
let rulesModel;

test.before(async () => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });

  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.ProvidersTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
  };

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;

  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  collectionsModel = new Collection();
  providersModel = new Provider();
  rulesModel = new Rule();

  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await providersModel.createTable();
  await rulesModel.createTable();
});

test('handler migrates async operations, collections, providers, rules', async (t) => {
  const call = await handler({});
  const expected = `
      Migration summary:
        Collections:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
        Providers:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
        AsyncOperations:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
        Rules:
          Out of 0 DynamoDB records:
            0 records migrated
            0 records skipped
            0 records failed
    `;
  t.is(call, expected);
});
