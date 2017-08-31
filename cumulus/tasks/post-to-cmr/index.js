'use strict';

const get = require('lodash.get');
const path = require('path');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { S3 } = require('@cumulus/ingest/aws');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { CMR } = require('@cumulus/cmrjs');
const { XmlMetaFileNotFound } = require('@cumulus/common/errors');
const testPayload = require('@cumulus/test-data/payloads/modis/cmr.json');
const log = require('@cumulus/ingest/log');

/**
 * The output returned by Cumulus-py has a broken payload
 * where files are not correctly grouped together. This function
 * will fix the returned output by cumulus-py until a fix is
 * issued there
 *
 */
function temporaryPayloadFix(_payload, collection, buckets) {
  const payload = _payload;

  if (payload.granules) {
    // first find the main granule object
    const granules = payload.granules.filter(g => g.granuleId !== undefined);

    for (const g of payload.granules) {
      if (!g.granuleId) {
        for (const file of g.files) {
          file.name = path.basename(file.filename);
          // find the bucket and url_path info
          for (const def of collection.files) {
            const test = new RegExp(def.regex);
            if (file.name.match(test)) {
              file.bucket = buckets[def.bucket];
              file.url_path = def.url_path || collection.url_path || '';
              break;
            }
          }
        }
        granules[0].files = granules[0].files.concat(g.files);
      }
    }

    payload.granules = granules;
  }
  return payload;
}

function getCmrFiles(granule) {
  const expectedFormats = [/.*\.meta\.xml$/];
  const cmrFiles = granule.files.map((file) => {
    const r = {
      granuleId: granule.granuleId
    };

    if (file.cmrFile) {
      r.file = file;
    }

    for (const regex of expectedFormats) {
      if (file.name.match(regex)) {
        r.file = file;
      }
    }
    return r.file ? r : null;
  });

  return cmrFiles.filter(f => f);
}

/**
 * getMetadata
 *
 * @param {string} xmlFilePath S3 URI to the xml metadata document
 * @returns {string} returns stringified xml document downloaded from S3
 */
async function getMetadata(xmlFilePath) {
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

async function decryptPassword(password) {
  try {
    const pass = await DefaultProvider.decrypt(password);
    return pass;
  }
  catch (e) {
    return password;
  }
}


/**
 * function for posting xml strings to CMR
 *
 * @param {string} xml The strigified xml document that has to be posted to CMR
 * @param {string} cmrProvider The name of of the CMR provider to be used
 * @returns {object} CMR's success response which includes the concept-id
 */

async function publish(cmrFile, creds) {
  const password = await decryptPassword(creds.password);
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const xml = await getMetadata(cmrFile.file.filename);
  const res = await cmr.ingestGranule(xml);

  return {
    granuleId: cmrFile.granuleId,
    conceptId: res.result['concept-id'],
    link: 'https://cmr.uat.earthdata.nasa.gov/search/granules.json' +
          `?concept_id=${res.result['concept-id']}`
  };
}


/**
 * Lambda function handler
 *
 * @param {object} event Lambda function payload
 * @param {object} context aws lambda context object
 * @param {function} cb lambda callback
 * @returns {object} returns the updated event object
 */
function handler(_event, context, cb) {
  try {
    // we have to post the meta-xml file of all output granules
    // first we check if there is an output file
    const event = _event;

    const collection = get(event, 'collection');
    const buckets = get(event, 'resources.buckets');
    const payload = temporaryPayloadFix(get(event, 'payload', null), collection, buckets);
    const creds = get(event, 'resources.cmr');

    // this lambda can only handle 1 granule at a time
    if (payload.granules.length > 1) {
      const err = new Error('Received more than 1 granule. ' +
                            'This function can only handle 1 granule a time');
      log.error(err);
      return cb(err);
    }

    // determine CMR files
    const cmrFiles = getCmrFiles(payload.granules[0]);

    // post all meta files to CMR
    const jobs = cmrFiles.map(c => publish(c, creds));

    return Promise.all(jobs).then((results) => {
      // update output section of the payload
      for (const result of results) {
        for (const g of payload.granules) {
          if (result.granuleId === g.granuleId) {
            delete result.granuleId;
            g.cmr = result;
            break;
          }
        }
      }

      event.payload = payload;

      return cb(null, event);
    }).catch(e => {
      log.error(e);
      cb(e);
    });
  }
  catch (e) {
    log.error(e);
    return cb(e);
  }
}

module.exports.handler = handler;

justLocalRun(() => {
  handler(testPayload, {}, (e, r) => log.debug(e, JSON.stringify(r)));
});
