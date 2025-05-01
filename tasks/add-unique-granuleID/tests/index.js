const test = require('ava');
const { assignUniqueIds } = require('../dist/src');

test('assignUniqueIds assigns unique granule IDs and preserves producerGranuleId', async (t) => {
  const hashDepth = 6;

  const event = {
    input: {
      granules: [
        { granuleId: 'granule1', collectionId: 'collection1' },
        { granuleId: 'granule2', collectionId: 'collection2' },
      ],
    },
    config: {
      hashDepth,
    },
  };

  const originalGranules = structuredClone(event.input.granules);
  const result = await assignUniqueIds(event, {});

  t.is(result.granules.length, 2, 'Output should have the same number of granules');
  result.granules.forEach((granule, index) => {
    t.is(granule.producerGranuleId, originalGranules[index].granuleId, 'Should preserve producerGranuleId as original granuleID value');
    t.true(granule.granuleId.startsWith(`${granule.producerGranuleId}_`), 'Should assign a unique granuleId');
    t.is(granule.granuleId.split('_')[1].length, hashDepth, 'Hash length should match the configured hashDepth');
  });
});

test('assignUniqueIds ignores granules that already have producerID assigned', async (t) => {
  const event = {
    input: {
      granules: [
        { granuleId: 'granule1', collectionId: 'collection1', producerGranuleId: 'existingGranuleId1' },
        { granuleId: 'granule2', collectionId: 'collection2', producerGranuleId: 'existingGranuleId2' },
      ],
    },
  };

  const result = await assignUniqueIds(event, {});
  const originalGranules = structuredClone(event.input.granules);

  t.is(result.granules.length, 2, 'Output should have the same number of granules');
  result.granules.forEach((granule, index) => {
    t.is(granule.producerGranuleId, originalGranules[index].producerGranuleId, 'Should preserve existing producerGranuleId');
    t.is(granule.granuleId, originalGranules[index].granuleId, 'Should not change granuleId if producerGranuleId is already set');
  });
});

test('assignUniqueIds handles empty granules array', async (t) => {
  const event = {
    input: {
      granules: [],
    },
  };

  const result = await assignUniqueIds(event, {});

  t.deepEqual(result.granules, [], 'Output should be an empty array');
});
