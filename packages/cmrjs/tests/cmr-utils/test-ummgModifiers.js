const test = require('ava');
const {
  updateUMMGGranuleURAndGranuleIdentifier,
} = require('../../ummgModifiers');

test('updates GranuleUR and adds ProducerGranuleId when Identifiers is missing', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
  });

  t.is(result.GranuleUR, 'NEW_ID');
  t.deepEqual(result.DataGranule.Identifiers, [
    {
      Identifier: 'PRODUCER_ID',
      IdentifierType: 'ProducerGranuleId',
    },
  ]);
});

test('overwrites existing ProducerGranuleId while preserving other identifiers', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
    DataGranule: {
      Identifiers: [
        { Identifier: 'FEATURE_XYZ', IdentifierType: 'FeatureId' },
        { Identifier: 'OLD_PRODUCER_ID', IdentifierType: 'ProducerGranuleId' },
        { Identifier: 'LOCAL_ABC', IdentifierType: 'LocalVersionId' },
      ],
    },
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'NEW_PRODUCER_ID',
  });

  t.is(result.GranuleUR, 'NEW_ID');

  const expectedIdentifiers = [
    { Identifier: 'FEATURE_XYZ', IdentifierType: 'FeatureId' },
    { Identifier: 'NEW_PRODUCER_ID', IdentifierType: 'ProducerGranuleId' },
    { Identifier: 'LOCAL_ABC', IdentifierType: 'LocalVersionId' },
  ];

  const sortIdentifiers = (ids) =>
    [...ids].sort((a, b) =>
      a.IdentifierType.localeCompare(b.IdentifierType));

  t.deepEqual(
    sortIdentifiers(result.DataGranule.Identifiers),
    sortIdentifiers(expectedIdentifiers)
  );
});

test('appends ProducerGranuleId if not present', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
    DataGranule: {
      Identifiers: [
        {
          Identifier: 'LOCAL_ID',
          IdentifierType: 'LocalVersionId',
        },
      ],
    },
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
  });

  t.is(result.GranuleUR, 'NEW_ID');
  t.is(result.DataGranule.Identifiers.length, 2);
  t.truthy(
    result.DataGranule.Identifiers.some(
      (id) =>
        id.Identifier === 'PRODUCER_ID' &&
        id.IdentifierType === 'ProducerGranuleId'
    )
  );
});

test('throws error if input is not UMMGGranule', (t) => {
  const invalid = {
    NotGranuleUR: 'abc',
  };

  const error = t.throws(() =>
    updateUMMGGranuleURAndGranuleIdentifier({
      metadataObject: invalid,
      granuleUr: 'ID',
      producerGranuleId: 'PRODUCER_ID',
    }));

  t.true(error?.message.includes('Invalid UMM-G JSON metadata'));
});

test('does not mutate original object', (t) => {
  const original = {
    GranuleUR: 'OLD_ID',
  };

  const copy = structuredClone(original);

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: original,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
  });

  t.not(result, original);
  t.deepEqual(original, copy);
});
