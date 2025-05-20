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
    it('executes successfully', async () => {});
    it('ingests a granule successfully', async () => {});
    it('it publishes the granule metadata to CMR', async () => {});
    it('it makes the granule available via the Cumulus API', async () => {});
    it('ingests a second granule with the same producerGranuleId but different collection', async () => {});

  });

  describe('The add-unique-granuleID task', () => {
    it('it updates the Cumulus Message with the appropriate granuleId and providerGranuleId', async () => {});
    it('it updates the CMR metadata with the appropriate granuleId and providerGranuleId', async () => {});
  });
});
