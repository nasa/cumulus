const test = require('ava');
const { validateInput, validateConfig, validateOutput } = require('@cumulus/common/test-utils');
const { assignUniqueIds } = require('../dist/src');

test('assignUniqueIds assigns unique granule IDs and preserves producerGranuleId', async (t) => {
  const hashLength = 6;

  const event = {
    input: {
      granules: [
        { granuleId: 'granule1', collectionId: 'collection1' },
        { granuleId: 'granule2', collectionId: 'collection2' },
      ],
    },
    config: {
      hashLength,
    },
  };

  const originalGranules = structuredClone(event.input.granules);
  const result = await assignUniqueIds(event, {});

  t.is(result.granules.length, 2, 'Output should have the same number of granules');
  result.granules.forEach((granule, index) => {
    t.is(granule.producerGranuleId, originalGranules[index].granuleId, 'Should preserve producerGranuleId as original granuleID value');
    t.true(granule.granuleId.startsWith(`${granule.producerGranuleId}_`), 'Should assign a unique granuleId');
    t.is(granule.granuleId.split('_')[1].length, hashLength, 'Hash length should match the configured hashLength');
  });
});

test('assignUniqueIds retains the rest of the passed in payload', async (t) => {
  const hashLength = 6;

  const payloadKeys = {
    pdrs: ['somePdrValue'],
    otherKey: { other: 'value' },
  };
  const event = {
    input: {
      granules: [
        { granuleId: 'granule1', collectionId: 'collection1' },
        { granuleId: 'granule2', collectionId: 'collection2' },
      ],
      ...payloadKeys,
    },
    config: {
      hashLength,
    },
  };
  const result = await assignUniqueIds(event, {});
  delete result.granules;
  t.deepEqual(result, payloadKeys, 'Should retain all non-granule keys in the payload');
});

test('assignUniqueIds ignores granules that already have producerGranuleId assigned', async (t) => {
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

test('assignUniqueIds accepts granules with dataType and version instead of collectionId', async (t) => {
  const event = {
    input: {
      granules: [
        { granuleId: 'granule1', dataType: 'someType', version: '001' },
        { granuleId: 'granule2', dataType: 'otherType', version: '002' },
      ],
    },
    config: { },
  };

  const result = await assignUniqueIds(event, {});
  t.is(result.granules.length, 2, 'Should return two granules');

  result.granules.forEach((granule) => {
    t.truthy(granule.producerGranuleId, 'Should assign producerGranuleId');
    t.true(granule.granuleId.startsWith(`${granule.producerGranuleId}_`), 'Should append hash to granuleId');
  });
});

test('assignUniqueIds assigns the same unique granule IDs for identical granules within a collection when includeTimestampHashKey is not set', async (t) => {
  const granuleId1 = 'granule1';
  const granuleId2 = 'granule2';
  const event = {
    input: {
      granules: [
        { granuleId: granuleId1, dataType: 'someType', version: '001' },
        { granuleId: granuleId2, dataType: 'someType', version: '001' },
      ],
    },
    config: { },
  };
  const event2 = structuredClone(event);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);
  const result1 = await assignUniqueIds(event, {});
  await validateOutput(t, result1);
  const result2 = await assignUniqueIds(event2, {});
  t.true(result1.granules[0].granuleId === result2.granules[0].granuleId, 'Should have the same granuleId even when ran another time');
  t.true(result1.granules[1].granuleId === result2.granules[1].granuleId, 'Should have the same granuleId even when ran another time');
  t.true(result1.granules[0].producerGranuleId === granuleId1, 'Should retain original granuleId as producerGranuleId');
  t.true(result1.granules[1].producerGranuleId === granuleId2, 'Should retain original granuleId as producerGranuleId');
});

test('assignUniqueIds assigns different unique granuleIds for identical granules when includeTimestampHashKey is set to true', async (t) => {
  const granuleId1 = 'granule1';
  const granuleId2 = 'granule2';
  const event = {
    input: {
      granules: [
        { granuleId: granuleId1, dataType: 'someType', version: '001' },
        { granuleId: granuleId2, dataType: 'someType', version: '001' },
      ],
    },
    config: {
      includeTimestampHashKey: true,
    },
  };
  const event2 = structuredClone(event);

  await validateConfig(t, event.config);
  await validateInput(t, event.input);
  const result1 = await assignUniqueIds(event, {});
  await validateOutput(t, result1);
  t.true(result1.granules[0].granuleId !== result1.granules[1].granuleId, 'Should not have the same granuleId');
  const result2 = await assignUniqueIds(event2, {});
  t.true(result1.granules[0].granuleId !== result2.granules[0].granuleId, 'Should not have the same granuleId even when ran another time');
  t.true(result1.granules[1].granuleId !== result2.granules[1].granuleId, 'Should not have the same granuleId even when ran another time');
  t.true(result1.granules[0].producerGranuleId === granuleId1, 'Should retain original granuleId as producerGranuleId');
  t.true(result1.granules[1].producerGranuleId === granuleId2, 'Should retain original granuleId as producerGranuleId');
});
