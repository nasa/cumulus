'use strict';

import get from 'lodash.get';
import { S3 } from '@cumulus/ingest/aws';
import { CMR } from '@cumulus/cmrjs';
import { XmlMetaFileNotFound } from '@cumulus/common/errors';

/**
 * getMetadata
 *
 * @param {string} xmlFilePath S3 URI to the xml metadata document
 * @returns {string} returns stringified xml document downloaded from S3
 */
export async function getMetadata(xmlFilePath) {
  // Identify the location of the metadata file,
  // conditional on the name of the collection

  if (!xmlFilePath) {
    throw new XmlMetaFileNotFound('XML Metadata file not provided');
  }

  // GET the metadata text
  // Currently, only supports files that are stored on S3
  const parts = xmlFilePath.match(/^s3:\/\/(.+?)\/(.+)$/);
  const obj = await S3.get(parts[1], parts[2]);

  return obj.Body.toString();
}


/**
 * function for posting xml strings to CMR
 *
 * @param {string} xml The strigified xml document that has to be posted to CMR
 * @param {string} cmrProvider The name of of the CMR provider to be used
 * @returns {object} CMR's success response which includes the concept-id
 */

export async function publish(collection, output, creds) {
  const granules = [];
  const cmr = new CMR(creds.provider, creds.clientId, creds.username, creds.password);

  for (const granule of output[collection.name].granules) {
    // get xml-meta if exists
    const xmlFilePath = get(granule, `files[\'${collection.cmrFile}\']`, null);

    if (xmlFilePath) {
      const xml = await getMetadata(xmlFilePath);
      const res = await cmr.ingestGranule(xml);

      // add conceptId to the record
      granule.cmrLink = 'https://cmr.uat.earthdata.nasa.gov/search/granules.json' +
        `?concept_id=${res.result['concept-id']}`;
      granule.published = true;
    }
    else {
      granule.published = false;
    }

    granules.push(granule);
  }

  return {
    collectionName: collection.name,
    granules
  };
}


/**
 * Lambda function handler
 *
 * @param {object} event Lambda function payload
 * @param {object} context aws lambda context object
 * @param {function} cb lambda callback
 * @returns 1A0000-2016111101_000_001{object} returns the updated event object[M`A[M`A[M`A
 */
export function handler(_event, context, cb) {
  try {
    // we have to post the meta-xml file of all output granules
    // first we check if there is an output file
    const event = _event;
    const collections = get(event, 'meta.collections');
    const output = get(event, 'payload.output');
    const creds = get(event, 'ingest_meta.config.cmr');

    // do nothing and return the payload as is
    if (!output) {
      return cb(null, event);
    }

    // for all granules of all output collections post to CMR if meta-xml key exists
    const jobs = Object.keys(output).map(c => publish(collections[c], output, creds));

    Promise.all(jobs).then((results) => {
      // update output section of the payload
      for (const result of results) {
        event.payload.output[result.collectionName].granules = result.granules;

        // also update granules info in the meta section of the payload
        for (const granule of result.granules) {
          event.meta.granules[granule.granuleId].cmrLink = get(granule, 'cmrLink', null);
          event.meta.granules[granule.granuleId].published = get(granule, 'published', false);
        }
      }
      return cb(null, event);
    }).catch(e => cb(e));
  }
  catch (e) {
    cb(e);
  }
}

