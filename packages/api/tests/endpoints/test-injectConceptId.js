'use strict';

const test = require('ava');
const fs = require('fs');
const cloneDeep = require('lodash.clonedeep');

const cmrjs = require('@cumulus/cmrjs');

const { getConceptId, injectConceptId } = require('../../lib/injectConceptId');

const returnEntry = (filename) => JSON.parse(fs.readFileSync(`${__dirname}/${filename}`)).feed.entry;
const emptyCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchEmpty.json');
const successCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchSuccess.json');
const multipleCmrReturn = () => returnEntry('fixtures/CMRCollectionSearchMultiples.json');
const ignoredCollectionRecord = { nothing: 'matters here' };

test('getConceptId returns null if CMR record does not exist.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(emptyCmrReturn());
  const conceptId = await getConceptId(ignoredCollectionRecord);
  t.is(null, conceptId);
});

test('getConceptId returns concept-id if CMR record exists.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(successCmrReturn());
  const expectedConceptId = 'C1234567890-CUMULUS';
  const conceptId = await getConceptId(ignoredCollectionRecord);
  t.is(expectedConceptId, conceptId);
});

test('getConceptId returns null if CMR returns more than 1 record.', async (t) => {
  cmrjs.searchConcept = async () => Promise.resolve(multipleCmrReturn());
  const conceptId = await getConceptId(ignoredCollectionRecord);
  t.is(null, conceptId);
});

test('Injects metadata into collections array.', async (t) => {
  const conceptId = 'INJECTED_CONCEPT_ID';
  const collReturn = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/collectionReturn.json`));
  let expected = cloneDeep(collReturn);
  expected = expected.results.map((res) => Object.assign(res, { conceptId: conceptId }));

  const updatedCollection = await injectConceptId(collReturn, () => conceptId);

  t.deepEqual(updatedCollection.results, expected);
});
