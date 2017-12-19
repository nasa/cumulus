/* eslint-disable no-param-reassign */
'use strict';

const get = require('lodash.get');
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
function temporaryPayloadFix(payload) {
  if (payload.granules) {
    const granules = {};

    // first find the main granule object
    payload.granules.forEach(g => {
      if (granules[g.granuleId]) {
        if (g.files && Array.isArray(g.files)) {
          granules[g.granuleId].files = granules[g.granuleId].files.concat(g.files);
          delete g.files;
          Object.assign(granules[g.granuleId], g);
        }
      }
      else {
        granules[g.granuleId] = g;
      }
    });

    payload.granules = Object.keys(granules).map(g => granules[g]);
  }
  return payload;
}

function getCmrFiles(granules) {
  let files = [];
  const expectedFormats = [/.*\.cmr\.xml$/];
  granules.forEach(granule => {
    files = files.concat(granule.files.map((file) => {
      const r = {
        granuleId: granule.granuleId
      };

      if (file.cmrFile) {
        r.file = file;
        r.file.granuleId = granule.granuleId;
        return r.file;
      }

      for (const regex of expectedFormats) {
        if (file.filename && file.filename.match(regex)) {
          r.file = file;
          r.file.granuleId = granule.granuleId;
          return r.file;
        }
      }
      return null;
    }));
  });

  return files.filter(f => f);
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

  const xml = await getMetadata(cmrFile.filename);
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

    const config = get(event, 'config');
    const collection = get(config, 'collection');
    const buckets = get(config, 'buckets');
    const creds = get(config, 'cmr');
    const input = temporaryPayloadFix(get(event, 'input', null), collection, buckets);

    // determine CMR files
    const cmrFiles = getCmrFiles(input.granules);

    // post all meta files to CMR
    const jobs = cmrFiles.map(c => publish(c, creds));

    return Promise.all(jobs).then((results) => {
      // update output section of the payload
      for (const result of results) {
        for (const g of input.granules) {
          if (result.granuleId === g.granuleId) {
            delete result.granuleId;
            g.cmr = result;
            break;
          }
        }
      }
      return input;
    })
      .then((output) => cb(null, output))
      .catch(e => {
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
