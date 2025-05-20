const test = require('ava');
const {
  updateEcho10XMLGranuleUrAndGranuleIdentifier,
} = require('../../echo10Modifiers');

test('updates GranuleUR and adds ProducerGranuleId when Identifiers is missing', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'OLD_ID',
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    identifier: 'PRODUCER_ID',
  });

  t.is(result.Granule.GranuleUR, 'NEW_ID');
  t.deepEqual(result.Granule.DataGranule?.Identifiers, [
    {
      Identifier: 'PRODUCER_ID',
      IdentifierType: 'ProducerGranuleId',
    },
  ]);
});

test('overwrites existing ProducerGranuleId while preserving other identifiers', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'OLD_ID',
      DataGranule: {
        Identifiers: [
          {
            Identifier: 'FEATURE_XYZ',
            IdentifierType: 'FeatureId',
          },
          {
            Identifier: 'OLD_PRODUCER_ID',
            IdentifierType: 'ProducerGranuleId',
          },
          {
            Identifier: 'LOCAL_ABC',
            IdentifierType: 'LocalVersionId',
          },
        ],
      },
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    identifier: 'PRODUCER_ID',
  });

  t.is(result.Granule.GranuleUR, 'NEW_ID');

  const expectedIdentifiers = [
    {
      Identifier: 'FEATURE_XYZ',
      IdentifierType: 'FeatureId',
    },
    {
      Identifier: 'PRODUCER_ID',
      IdentifierType: 'ProducerGranuleId',
    },
    {
      Identifier: 'LOCAL_ABC',
      IdentifierType: 'LocalVersionId',
    },
  ];
  const sortIdentifiers = (ids) =>
    [...ids].sort((a, b) =>
      a.IdentifierType.localeCompare(b.IdentifierType));

  t.deepEqual(
    sortIdentifiers(result.Granule.DataGranule.Identifiers),
    sortIdentifiers(expectedIdentifiers)
  );
});

test('appends ProducerGranuleId if not present', (t) => {
  const xml = {
    Granule: {
      GranuleUR: 'OLD_ID',
      DataGranule: {
        Identifiers: [
          {
            Identifier: 'other',
            IdentifierType: 'LocalVersionId',
          },
        ],
      },
    },
  };

  const result = updateEcho10XMLGranuleUrAndGranuleIdentifier({
    xml,
    granuleUr: 'NEW_ID',
    identifier: 'NEW_PRODUCER_ID',
  });

  t.is(result.Granule.GranuleUR, 'NEW_ID');
  t.is(result.Granule.DataGranule?.Identifiers?.length, 2);
  t.deepEqual(result.Granule.DataGranule?.Identifiers?.[1], {
    Identifier: 'NEW_PRODUCER_ID',
    IdentifierType: 'ProducerGranuleId',
  });
});

test('throws error if input is not Echo10XmlBaseGranule', (t) => {
  const invalid = {
    NotGranule: {},
  };

  const error = t.throws(() =>
    updateEcho10XMLGranuleUrAndGranuleIdentifier({
      xml: invalid,
      granuleUr: 'ID',
      identifier: 'PRODUCER_ID',
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
    identifier: 'PRODUCER_ID',
  });

  t.not(result, original);
  t.deepEqual(original, copy);
});
