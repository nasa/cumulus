'use strict';

import get from 'lodash.get';
import { S3 } from '@cumulus/common/aws-helpers';
import { ingestGranule } from '@cumulus/common/cmrjs';
import { XmlMetaFileNotFound } from '@cumulus/common/errors';

const logDetails = {
  file: 'lambdas/cmrPush/index.js',
  source: 'pushToCMR',
  type: 'processing'
};

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
export async function postToCMR(xml, cmrProvider) {
  // TODO: pass the username and password provided by the payload
  // This requires some changes to how cmrjs is initialized and accesses credentials
  return ingestGranule(xml, cmrProvider);
}

export async function cmr(collectionName, event) {
  const output = get(event, 'payload.output');
  const cmrProvider = get(event, 'collection.meta.cmrProvider', 'CUMULUS');
  const granules = [];

  for (const granule of output[collectionName].granules) {
    // get xml-meta if exists
    const xmlFilePath = get(granule, 'files[\'meta-xml\']', null);

    if (xmlFilePath) {
      const xml = await getMetadata(xmlFilePath);
      const res = await postToCMR(xml, cmrProvider);

      logDetails.collectionName = get(event, 'collection.id');
      logDetails.pdrname = get(event, 'payload.pdrname');
      logDetails.granuleId = get(granule, 'granuleId', 'unknown_granule');

      // add conceptId to the record
      granule.cmrLink = 'https://cmr.uat.earthdata.nasa.gov/search/granules.json' +
        `?concept_id=${res.result['concept-id']}`;
      granule.published = true;
    }

    granules.push(granule);
  }

  return {
    collectionName,
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
export function handler(event, context, cb) {
  try {
    // we have to post the meta-xml file of all output granules
    // first we check if there is an output file
    const output = get(event, 'payload.output');

    // do nothing and return the payload as is
    if (!output) {
      return cb(null, event);
    }

    // for all granules of all output collections post to CMR if meta-xml key exists
    const jobs = [];
    for (const collectionName in output) {
      jobs.push(cmr(collectionName, event));
    }

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

