'use strict';

beforeAll(async () => {});
afterAll(async () => {});

describe('The Ingest Granules workflow with unique duplicate handling', () => {
    it('prepares the test suite successfully', () => {
        failOnSetupError([beforeAllError]);
    });
    it('completes execution with success status', async () => {
        failOnSetupError([beforeAllError]);
        const workflowExecutionStatus = await waitForCompletedExecution(workflowExecutionArn);
        expect(workflowExecutionStatus).toEqual('SUCCEEDED');
    });
    it('makes the granule available through the Cumulus API', async () => {});
});

describe('the SyncGranules task', () => {
    it('updates the meta object with input_granules', () => {});
});

describe('the PostToCmr task', () => {
    it('publishes the granule metadata to CMR', async () => {
      failOnSetupError([beforeAllError, subTestSetupError]);
    });
});

describe('The Cumulus API', () => {
    it('makes the granule available through the Cumulus API', () => {
        failOnSetupError([beforeAllError, subTestSetupError]);
    });
});

describe('when moving a granule', () => {
    it('rejects moving a granule to a location that already exists', async () => {});
    it('when the file is deleted and the move retried, the move completes successfully', async () => {});
});

// TODO need clarity on behavior here
describe('Granule files already exists in different collection', () => {
    it('fails ingest', () => {});
    it('does not overwrite files', () => {});
});

// TODO need clarity on behavior here
describe('Granule files already exists in same collection', () => {
    it('fails ingest', () => {});
    it('does not overwrite files', () => {});
});

describe('Granule with same producerGranuleId exists in the same collection', () => {
    describe('When set to "error"', () => {
        it('fails ingest', () => {});
        it('does not overwrite files', () => {});
    });
    describe('When set to "skip"', () => {
        it('ingest succeeds', () => {});
        it('does not ingest the duplicate', () => {});
        it('does not overwrite files', () => {});
    });
    describe('When set to "replace"', () => {
        it('ingest succeeds', () => {});
        it('does ingest the duplicate', () => {});
        it('does overwrite files', () => {});
    });
    describe('When set to "version"', () => {
        it('ingest succeeds', () => {});
        it('does ingest the duplicate', () => {});
        it('does not overwrite files', () => {});
        // TODO what is 'hides'?
        it('hides the previous granule', () => {});
    });
});