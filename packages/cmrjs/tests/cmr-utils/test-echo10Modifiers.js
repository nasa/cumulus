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
  t.deepEqual(result.Granule.DataGranule.ProducerGranuleId, 'PRODUCER_ID');
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
  t.is(result.Granule.DataGranule.ProducerGranuleId, 'NEW_PRODUCER_ID');
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
