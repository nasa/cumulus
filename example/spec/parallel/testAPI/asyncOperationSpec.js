const { createAsyncOperation, listAsyncOperations, deleteAsyncOperation } = require('@cumulus/api-client/asyncOperations');
const { fakeAsyncOperationFactory } = require('@cumulus/api/lib/testUtils');
const { loadConfig } = require('../../helpers/testUtils');

let prefix;
let config;
let writtenAsyncOperation;

beforeAll(async () => {
  config = await loadConfig();
  prefix = config.stackName;
});

afterAll(async () => {
  await deleteAsyncOperation({ prefix, asyncOperationId: writtenAsyncOperation.id });
});

describe('The Async Operations API', () => {
  it('creates an async operation', async () => {
    const asyncOperation = { ...(fakeAsyncOperationFactory()), createdAt: undefined, updatedAt: undefined };
    const response = await createAsyncOperation({
      prefix,
      asyncOperation,
    });

    writtenAsyncOperation = JSON.parse(response.body).record;
    expect(writtenAsyncOperation.id).toEqual(asyncOperation.id);
  });

  // This test cannot run until 3235 is merged/resolved
  xit('lists async operations', async () => {
    const asyncOperations = await listAsyncOperations({ prefix });
    const filteredAsyncOperations = asyncOperations.filter((o) => o.id === writtenAsyncOperation.id);
    expect(filteredAsyncOperations.length).toBe(1);
    expect(filteredAsyncOperations[0].id).toBe(writtenAsyncOperation.id);
  });
});
