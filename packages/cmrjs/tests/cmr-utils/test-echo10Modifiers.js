const test = require('ava');
const {
  updateEcho10XMLGranuleUrAndGranuleIdentifier,
} = require('../../echo10Modifiers');

test('updates GranuleUR and updates ProducerGranuleId', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'OLD_ID',
      DataGranule: {
        ProducerGranuleId: 'OLD_PRODUCER_ID',
      },
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
  });

  t.is(result.Granule.GranuleUR, 'NEW_ID');
  t.true(result.Granule.DataGranule instanceof Map, 'DataGranule should be a Map');
  t.is(result.Granule.DataGranule.get('ProducerGranuleId'), 'PRODUCER_ID');
});

test('adds ProducerGranuleId if not present', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'OLD_ID',
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'NEW_PRODUCER_ID',
  });

  t.is(result.Granule.GranuleUR, 'NEW_ID');
  t.true(result.Granule.DataGranule instanceof Map);
  t.is(result.Granule.DataGranule.get('ProducerGranuleId'), 'NEW_PRODUCER_ID');
});

test('throws error if input is not Echo10XmlBaseGranule', (t) => {
  const invalid = {
    NotGranule: {},
  };

  const error = t.throws(() =>
    updateEcho10XMLGranuleUrAndGranuleIdentifier({
      xml: invalid,
      granuleUr: 'ID',
      producerGranuleId: 'PRODUCER_ID',
    }));

  t.true(error?.message.includes('Invalid XML input'));
});

test('does not mutate original object', (t) => {
  const original = {
    Granule: {
      GranuleUR: 'OLD_ID',
    },
  };

  const copy = structuredClone(original);

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml: original,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
  });

  t.not(result, original);
  t.deepEqual(original, copy);
});

test('maintains ECHO10 schema order for DataGranule elements', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'TEST_ID',
      DataGranule: {
        // These are intentionally out of order
        ProductionDateTime: '2024-01-15T10:00:00Z',
        DayNightFlag: 'Day',
        Checksum: { Value: 'abc123', Algorithm: 'MD5' },
        DataGranuleSizeInBytes: 1024,
        LocalVersionId: 'v1.0',
      },
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_123',
  });

  t.true(result.Granule.DataGranule instanceof Map);
  const keys = Array.from(result.Granule.DataGranule.keys());

  // Expected order according to ECHO10 XSD schema
  const expectedOrder = [
    'DataGranuleSizeInBytes',
    'Checksum',
    'ProducerGranuleId',
    'DayNightFlag',
    'ProductionDateTime',
    'LocalVersionId',
  ];

  t.deepEqual(keys, expectedOrder);

  t.is(result.Granule.DataGranule.get('DataGranuleSizeInBytes'), 1024);
  t.deepEqual(result.Granule.DataGranule.get('Checksum'), { Value: 'abc123', Algorithm: 'MD5' });
  t.is(result.Granule.DataGranule.get('ProducerGranuleId'), 'PRODUCER_123');
  t.is(result.Granule.DataGranule.get('DayNightFlag'), 'Day');
  t.is(result.Granule.DataGranule.get('ProductionDateTime'), '2024-01-15T10:00:00Z');
  t.is(result.Granule.DataGranule.get('LocalVersionId'), 'v1.0');
});

test('ProducerGranuleId appears in correct position relative to other fields', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'TEST_ID',
      DataGranule: {
        SizeMBDataGranule: 2.5,
        DayNightFlag: 'Night',
        ProductionDateTime: '2024-01-15T10:00:00Z',
      },
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_456',
  });

  const keys = Array.from(result.Granule.DataGranule.keys());

  t.deepEqual(keys, [
    'SizeMBDataGranule',
    'ProducerGranuleId',
    'DayNightFlag',
    'ProductionDateTime',
  ]);

  const sizeIndex = keys.indexOf('SizeMBDataGranule');
  const producerIndex = keys.indexOf('ProducerGranuleId');
  const dayNightIndex = keys.indexOf('DayNightFlag');

  t.true(sizeIndex < producerIndex, 'SizeMBDataGranule should come before ProducerGranuleId');
  t.true(producerIndex < dayNightIndex, 'ProducerGranuleId should come before DayNightFlag');
});
