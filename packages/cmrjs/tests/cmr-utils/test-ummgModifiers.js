const test = require('ava');
const {
  updateUMMGGranuleURAndGranuleIdentifier,
} = require('../../ummgModifiers');

test.before(() => {
  // Mocking the date for ProductionDateTime value checks
  global.Date = class extends Date {
    constructor() {
      super('2024-01-01T00:00:00Z');
    }
  };
});

test.after.always(() => {
  global.Date = Date;
});

test('updates GranuleUR and adds ProducerGranuleId when Identifiers is missing', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
    excludeDataGranule: false,
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
    excludeDataGranule: false,
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
    excludeDataGranule: false,
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
      excludeDataGranule: false,
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
    excludeDataGranule: false,
  });

  t.not(result, original);
  t.deepEqual(original, copy);
});

test('does not add DataGranule when excludeDataGranule is true', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
    excludeDataGranule: true,
  });

  t.is(result.DataGranule, undefined);
});

test('does not update DataGranule when excludeDataGranule is true', (t) => {
  const metadata = {
    GranuleUR: 'SAME_ID',
    DataGranule: {
      Identifiers: [
        { Identifier: 'LOCAL_ID', IdentifierType: 'LocalVersionId' },
      ],
      ProductionDateTime: '2023-12-31T23:59:59Z',
      DayNightFlag: 'DAY',
    },
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'SAME_ID',
    producerGranuleId: 'NEW_PRODUCER_ID',
    excludeDataGranule: true,
  });

  t.deepEqual(result.DataGranule, metadata.DataGranule);
});

test('updates DataGranule with new identifiers and required default values when excludeDataGranule is false', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
    DataGranule: {
      Identifiers: [
        { Identifier: 'LOCAL_ID', IdentifierType: 'LocalVersionId' },
      ],
    },
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'NEW_PRODUCER_ID',
    excludeDataGranule: false,
  });

  const expectedDataGranule = {
    Identifiers: [
      { Identifier: 'LOCAL_ID', IdentifierType: 'LocalVersionId' },
      { Identifier: 'NEW_PRODUCER_ID', IdentifierType: 'ProducerGranuleId' },
    ],
    DayNightFlag: 'UNSPECIFIED',
  };

  t.deepEqual(result.DataGranule, expectedDataGranule);
});

test('does not overwrite DataGranule values when excludeDataGranule is false', (t) => {
  const metadata = {
    GranuleUR: 'OLD_ID',
    DataGranule: {
      Identifiers: [
        { Identifier: 'LOCAL_ID', IdentifierType: 'LocalVersionId' },
        { Identifier: 'PRODUCER_ID', IdentifierType: 'ProducerGranuleId' },
      ],
      DayNightFlag: 'DAY',
      ProductionDateTime: '2022-12-31T23:59:59Z',
    },
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'NEW_ID',
    producerGranuleId: 'PRODUCER_ID',
    excludeDataGranule: false,
  });

  t.deepEqual(result.DataGranule, metadata.DataGranule);
});

test('adds DataGranule when excludeDataGranule is false and populates required defaults', (t) => {
  const metadata = {
    GranuleUR: 'ID',
  };

  const result = updateUMMGGranuleURAndGranuleIdentifier({
    metadataObject: metadata,
    granuleUr: 'ID',
    producerGranuleId: 'NEW_PRODUCER_ID',
    excludeDataGranule: false,
  });

  const expectedDataGranule = {
    Identifiers: [
      { Identifier: 'NEW_PRODUCER_ID', IdentifierType: 'ProducerGranuleId' },
    ],
    // Date mocked in tests, as noted above, so this is the expected value for ProductionDateTime
    // despite actually being the time the task is ran (which is what is mocked, Date.now())
    ProductionDateTime: new Date('2024-01-01T00:00:00Z').toISOString(),
    DayNightFlag: 'UNSPECIFIED',
  };

  t.deepEqual(result.DataGranule, expectedDataGranule);
});
