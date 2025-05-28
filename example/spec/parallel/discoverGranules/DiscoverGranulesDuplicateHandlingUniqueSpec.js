'use strict';



describe('Ingesting duplicate granules using DiscoverGranules', () => {

  beforeAll(async () => {
    try {

    } catch (error) {
      beforeAllError = error;
      throw error;
    }
  });

  afterAll(async () => {});

  describe('The DiscoverGranules workflow with unique granule handling', () => {
    it('prepares the test suite successfully', () => {
      failOnSetupError([beforeAllError]);
    });
    it('executes successfully', async () => {});
    it('results in a successful IngestGranule workflow execution', async () => {});
    it('it makes the granule available via the Cumulus API', async () => {});
    it('it publishes the granule metadata to CMR', async () => {});
  });

  // TODO: do we need all of these assertions for the second workflow execution?
  //  Do we want to just include the duplicate granule in the above workflow execution?
  describe('The DiscoverGranules workflow ingests a second granule with the same producerGranuleId but different collection', () => {
    it('executes successfully', async () => {});
    it('results in a successful IngestGranule workflow execution', async () => {});
    it('it makes the granule available via the Cumulus API', async () => {});
    it('it publishes the granule metadata to CMR', async () => {});
  });

  describe('The add-unique-granuleID task', () => {
    it('it updates the Cumulus Message with the appropriate granuleId and providerGranuleId', async () => {});
    it('it updates the CMR metadata with the appropriate granuleId and providerGranuleId', async () => {});
  });
});
