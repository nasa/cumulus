'use strict';

const { CMR, CMRSearchConceptQueue } = require('@cumulus/cmr-client');

// searchConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _searchConcept = require('@cumulus/cmr-client/searchConcept');
// ingestConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _ingestConcept = require('@cumulus/cmr-client/ingestConcept');
// deleteConcept is being imported for backwards compat,
// but is not part of the cmr-client public API
const _deleteConcept = require('@cumulus/cmr-client/deleteConcept');
const { deprecate } = require('@cumulus/common/util');

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for searchConcept see _searchConcept */
async function searchConcept(type, searchParams, previousResults = [], headers = {}) {
  deprecate('@cmrjs/searchConcept', '1.11.1', '@cmrjs/CMR.search(Collections|Granules)');
  return _searchConcept(type, searchParams, previousResults, headers);
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for ingestConcept see _ingestConcept */
async function ingestConcept(type, xml, identifierPath, provider, headers) {
  deprecate('@cmrjs/ingestConcept', '1.11.1', '@cmrjs/CMR.ingest(Collection|Granule)');
  return _ingestConcept(type, xml, identifierPath, provider, headers);
}

/* eslint-disable-next-line valid-jsdoc */
/** deprecation wrapper for deleteConcept see _deleteConcept */
async function deleteConcept(type, identifier, provider, headers) {
  deprecate('@cmrjs/deleteConcept', '1.11.1', '@cmrjs/CMR.delete(Collection|Granule)');
  return _deleteConcept(type, identifier, provider, headers);
}

module.exports = {
  _searchConcept,
  searchConcept,
  ingestConcept,
  deleteConcept,
  CMR,
  CMRSearchConceptQueue
};
