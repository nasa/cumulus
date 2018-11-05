'use strict';

const test = require('ava');
const fs = require('fs');
const cloneDeep = require('lodash.clonedeep');

const cmrjs = require('@cumulus/cmrjs');

const { updateRecordWithConceptId, injectConceptIds } = require('../../lib/injectConceptId');

const returnEntry = (filename) => JSON.parse(fs.readFileSync(`${__dirname}/${filename}`)).feed.entry;
const emptyCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchEmpty.json');
const successCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchSuccess.json');
const multipleCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchMultiples.json');
const testCollectionRecord = { nothing: 'matters here' };

test.serial('updateRecordWithConceptId injects null if CMR record does not exist.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(emptyCmrReturn());
  const expected = Object.assign({}, testCollectionRecord, { conceptId: null });
  const updatedRecord = await updateRecordWithConceptId(testCollectionRecord);
  t.deepEqual(expected, updatedRecord);
});

test.serial('updateRecordWithConceptId injects concept-id if CMR record exists.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(successCmrReturn());
  const expectedConceptId = 'C1234567890-CUMULUS';
  const expected = Object.assign({}, testCollectionRecord, { conceptId: expectedConceptId });
  console.log(testCollectionRecord);
  const updatedRecord = await updateRecordWithConceptId(testCollectionRecord);
  t.deepEqual(expected, updatedRecord);
});

test.serial('updateRecordWithConceptId injects null if CMR returns more than 1 record.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(multipleCmrReturn());
  const expected = Object.assign({}, testCollectionRecord, { conceptId: null });
  const updatedRecord = await updateRecordWithConceptId(testCollectionRecord);
  t.deepEqual(expected, updatedRecord);
});

test('Injects metadata into collections array.', async (t) => {
  const conceptId = 'INJECTED_CONCEPT_ID';
  const collReturn = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/collectionReturn.json`));
  const expected = cloneDeep(collReturn);
  expected.results = expected.results.map((res) => Object.assign(res, { conceptId: conceptId }));
  console.log(expected);
  const updatedCollection = await injectConceptIds(
    collReturn, (collection) => Object.assign(collection, { conceptId: conceptId })
  );

  console.log(updatedCollection);

  t.deepEqual(updatedCollection, expected);
});
