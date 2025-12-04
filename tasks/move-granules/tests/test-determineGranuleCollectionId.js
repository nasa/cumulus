'use strict';

const test = require('ava');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { determineGranuleCollectionId } = require('..');

test('determineGranuleCollectionId returns collection ID from granule if dataType and version are present', (t) => {
  const dataType = 'MOD11A1';
  const version = '006';
  const granule = {
    dataType,
    version,
  };
  const configCollection = {
    name: 'OtherName',
    version: 'OtherVersion',
  };

  const result = determineGranuleCollectionId(granule, configCollection);
  const expected = constructCollectionId(dataType, version);

  t.is(result, expected);
});

test('determineGranuleCollectionId returns collection ID from collection config if name and version are present and granule fields are missing', (t) => {
  const name = 'MOD11A1';
  const version = '006';
  const granule = {
    // dataType and version are missing
  };
  const configCollection = {
    name,
    version,
  };

  const result = determineGranuleCollectionId(granule, configCollection);
  const expected = constructCollectionId(name, version);

  t.is(result, expected);
});

test('determineGranuleCollectionId returns undefined if neither source has complete information', (t) => {
  // Granule with missing version
  const granule1 = {
    dataType: 'MOD11A1',
  };
  // Config collection with missing name
  const configCollection1 = {
    version: '006',
  };

  const result1 = determineGranuleCollectionId(granule1, configCollection1);
  t.is(result1, undefined);

  // Granule with missing dataType
  const granule2 = {
    version: '006',
  };
  // Config collection with missing version
  const configCollection2 = {
    name: 'MOD11A1',
  };

  const result2 = determineGranuleCollectionId(granule2, configCollection2);
  t.is(result2, undefined);

  // Both completely missing
  const granule3 = {};
  const configCollection3 = {};

  const result3 = determineGranuleCollectionId(granule3, configCollection3);
  t.is(result3, undefined);
});

test('determineGranuleCollectionId prioritizes granule over collection configuration', (t) => {
  // Both granule and configCollection have complete data, but with different values
  const granule = {
    dataType: 'GranuleDataType',
    version: 'GranuleVersion',
  };
  const configCollection = {
    name: 'ConfigName',
    version: 'ConfigVersion',
  };

  const result = determineGranuleCollectionId(granule, configCollection);
  const expected = constructCollectionId(granule.dataType, granule.version);

  t.is(result, expected);
  // Verify it's not using the config values
  t.not(result, constructCollectionId(configCollection.name, configCollection.version));
});

test('determineGranuleCollectionId handles partial granule data by falling back to collection config', (t) => {
  // Granule with only dataType, missing version
  const granule = {
    dataType: 'GranuleDataType',
  };
  const configCollection = {
    name: 'ConfigName',
    version: 'ConfigVersion',
  };

  const result = determineGranuleCollectionId(granule, configCollection);
  const expected = constructCollectionId(configCollection.name, configCollection.version);

  t.is(result, expected);
});
