import got, { Headers } from 'got';
import Logger from '@cumulus/logger';

const log = new Logger({ sender: 'cmr-client' });

async function getGranuleConceptMetadata(
  conceptLink: string,
  headers: Headers,
  type: string
): Promise<unknown> {
  let response;
  try {
    response = await got.get(conceptLink, { headers });
  } catch (error) {
    log.error(`Error getting concept metadata from ${conceptLink}`, error);
    return undefined;
  }

  if (response.statusCode !== 200) {
    log.error(`Received statusCode ${response.statusCode} getting concept metadata from ${conceptLink}`);
    return undefined;
  }
  const body = JSON.parse(response.body);
  if (type === 'granuleConceptSearch') {
    return body;
  }
  if (type === 'granuleSearch') {
    return body.feed.entry[0];
  }
  throw new Error(`Invalid type ${type}`);
}

/**
 * Get the CMR JSON metadata from a CMR granule search
 *
 * @param {string} conceptLink - link to concept in CMR
 * @param {Object} headers - the CMR headers
 * @returns {Object} - metadata as a JS object, null if not
 * found
 */
async function getConceptMetadata(
  conceptLink: string,
  headers: Headers
): Promise<unknown> {
  if (conceptLink.match(/search\/granules.json\?/)) {
    return getGranuleConceptMetadata(conceptLink, headers, 'granuleSearch' );
  }
  if (conceptLink.match(/\/search\/concepts\//)) {
    return getGranuleConceptMetadata(conceptLink.replace(/(.echo10)$/, '.json'), headers, 'granuleConceptSearch');
  }
  throw new Error(`Unhandled CMR conceptLink -- links must either search by granule/concept_id or granule concept: ${conceptLink}`);
}

export = getConceptMetadata;
