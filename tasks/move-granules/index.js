'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const { moveGranuleFile, getCmrFiles, getGranuleId } = require('@cumulus/ingest/granule');
const urljoin = require('url-join');
const path = require('path');
const {
  aws: {
    parseS3Uri,
    promiseS3Upload
  }
} = require('@cumulus/common');
const { urlPathTemplate } = require('@cumulus/ingest/url-path-template');
const xml2js = require('xml2js');
const log = require('@cumulus/common/log');

/**
 * Creates an object with all granule files
 * from the input array and the input_granules config
 *
 * @param {Array} input - the task input array
 * @param {Array} granules - an array of the granules
 * @param {string} regex - regex needed to extract granuleId from filenames
 * @returns {Object} an object that contains all granules
 * with the granuleId as the key of each granule
 */
function getAllGranules(input, granules, regex) {
  const granulesHash = {};
  const filesHash = {};

  // create hash list of the granules
  // and a hash list of files
  granules.forEach((g) => {
    granulesHash[g.granuleId] = g;
    g.files.forEach((f) => {
      filesHash[f.filename] = g.granuleId;
    });
  });

  // add input files to corresponding granules
  // the process involve getting granuleId of each file
  // match it against the granuleObj and adding the new files to the
  // file list
  input.forEach((f) => {
    if (f && !filesHash[f]) {
      const granuleId = getGranuleId(f, regex);
      const uriParsed = parseS3Uri(f);
      granulesHash[granuleId].files.push({
        filename: f,
        bucket: uriParsed.Bucket,
        name: path.basename(f)
      });
    }
  });

  return granulesHash;
}

/**
* Update the granule metadata with the final location of files.
* For each granule file, find the collection regex that goes with it and use
* that to construct the url path. Return the updated granules object.
*
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @param {Object} collection - configuration object defining a collection
* of granules and their files
* @param {string} cmrFiles - array of objects that include CMR xmls uris and granuleIds
* @param {Object} buckets - the buckets involved with the files
* @returns {Promise} promise resolves when all files have been moved
**/
function updateGranuleMetadata(granulesObject, collection, cmrFiles, buckets) {
  const allFiles = [];
  Object.keys(granulesObject).forEach((granuleId) => {
    granulesObject[granuleId].files.forEach((file) => {
      collection.files.forEach((fileConfig) => {
        const match = file.name.match(fileConfig.regex);

        if (match) {
          if (!file.url_path) {
            file.url_path = fileConfig.url_path || collection.url_path || '';
          }
          const cmrFile = cmrFiles.find((f) => f.granuleId === granuleId);

          const urlPath = urlPathTemplate(file.url_path, {
            file: file,
            granule: granulesObject[granuleId],
            cmrMetadata: cmrFile ? cmrFile.metadataObject : {}
          });

          if (!buckets[fileConfig.bucket]) {
            throw new Error(`Collection config specifies a bucket key of ${fileConfig.bucket}, but the configured bucket keys are: ${Object.keys(buckets).join(', ')}`);
          }
          file.bucket = buckets[fileConfig.bucket];
          file.filepath = path.join(urlPath, file.name);
          file.filename = `s3://${path.join(file.bucket.name, file.filepath)}`;

          allFiles.push(file);
        }
      });
    });
  });

  return {
    granulesObject,
    allFiles
  };
}

/**
* Move all files in a collection of granules from staging location fo final location
*
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @param {string} sourceBucket - source bucket location of files
* @returns {Promise} promise resolves when all files have been moved
**/
async function moveGranuleFiles(granulesObject, sourceBucket) {
  const moveFileRequests = [];

  Object.keys(granulesObject).forEach((granuleKey) => {
    const granule = granulesObject[granuleKey];
    const expectedFormat = /.*\.cmr\.xml$/;

    granule.files.forEach((file) => {
      if (!(file.name.match(expectedFormat))) {
        const fileStagingDir = file.fileStagingDir || 'file-staging';
        const source = {
          Bucket: sourceBucket,
          Key: `${fileStagingDir}/${file.name}`
        };

        const target = {
          Bucket: file.bucket.name,
          Key: file.filepath
        };
        delete file.fileStagingDir;
        const options = (file.bucket.type.match('public')) ? { ACL: 'public-read' } : null;
        moveFileRequests.push(moveGranuleFile(source, target, options));
      }
    });
  });

  return Promise.all(moveFileRequests);
}


/**
* Update the online access url fields in CMR xml files
*
* @param {string} cmrFiles - array of objects that include CMR xmls uris and granuleIds
* @param {Object} granulesObject - an object of the granules where the key is the granuleId
* @param {Array} allFiles - array of all files in all granules
* @param {string} distEndpoint - the api distribution endpoint
* @returns {Promise} promise resolves when all files have been updated
**/
async function updateCmrFileAccessURLs(cmrFiles, granulesObject, allFiles, distEndpoint) {
  await Promise.all(cmrFiles.map(async (cmrFile) => {
    const metadataGranule = get(cmrFile, 'metadataObject.Granule');
    const granule = granulesObject[cmrFile.granuleId];
    const urls = [];
    // Populates onlineAcessUrls with all public and protected files
    allFiles.forEach((file) => {
      const urlObj = {};
      if (file.bucket.type.match('protected')) {
        const extension = urljoin(file.bucket.name, file.filepath);
        urlObj.URL = urljoin(distEndpoint, extension);
        urlObj.URLDescription = 'File to download';
        urls.push(urlObj);
        log.info(`protected file: ${JSON.stringify(file)},\nurl: ${JSON.stringify(urlObj)}`);
      }
      else if (file.bucket.type.match('public')) {
        urlObj.URL = `https://${file.bucket.name}.s3.amazonaws.com/${file.filepath}`;
        urlObj.URLDescription = 'File to download';
        urls.push(urlObj);
      }
    });

    const updatedGranule = {};
    Object.keys(metadataGranule).forEach((key) => {
      if (key === 'OnlineResources' || key === 'Orderable') {
        updatedGranule.OnlineAccessURLs = {};
      }
      updatedGranule[key] = metadataGranule[key];
    });
    updatedGranule.OnlineAccessURLs.OnlineAccessURL = urls;
    cmrFile.metadataObject.Granule = updatedGranule;

    const builder = new xml2js.Builder();
    const xml = builder.buildObject(cmrFile.metadataObject);
    cmrFile.metadata = xml;
    const updatedCmrFile = granule.files.find((f) => f.filename.match(/.*\.cmr\.xml$/));
    if (updatedCmrFile.bucket.type.match('public')) {
      await promiseS3Upload({
        Bucket: updatedCmrFile.bucket.name,
        Key: updatedCmrFile.filepath,
        Body: xml,
        ACL: 'public-read'
      });
    }
    else {
      await promiseS3Upload(
        { Bucket: updatedCmrFile.bucket.name, Key: updatedCmrFile.filepath, Body: xml }
      );
    }
  }));
}

/**
 * Move Granule files to final Location
 * See the schemas directory for detailed input and output schemas
 *
 * @param {Object} event -Lambda function payload
 * @param {Object} event.config - the config object
 * @param {string} event.config.bucket - the bucket name where public/private keys
 *                                       are stored
 * @param {string} event.config.granuleIdExtraction - regex needed to extract granuleId
 *                                                    from filenames
 * @param {Array} event.config.input_granules - an array of granules
 * @param {string} event.config.distribution_endpoint - distribution enpoint for the api
 * @param {Object} event.config.collection - configuration object defining a collection
 * of granules and their files
 * @param {boolean} [event.config.moveStagedFiles=true] - set to false to skip moving files
 * from staging to final bucket. Mostly useful for testing.
 * @param {Array} event.input - an array of s3 uris
 * @returns {Promise} returns the promise of an updated event object
 */
async function moveGranules(event) {
  // we have to post the meta-xml file of all output granules
  // first we check if there is an output file
  const config = get(event, 'config');
  const bucket = get(config, 'bucket'); // the name of the bucket with private/public keys
  const buckets = get(config, 'buckets');
  const regex = get(config, 'granuleIdExtraction', '(.*)');
  const inputGranules = get(config, 'input_granules', {});
  const distEndpoint = get(config, 'distribution_endpoint');
  const moveStagedFiles = get(config, 'moveStagedFiles', true);
  const collection = config.collection;
  const input = get(event, 'input', []);

  // get cmr files from staging location
  const cmrFiles = await getCmrFiles(input, regex);

  // create granules object for cumulus indexer
  let allGranules = getAllGranules(input, inputGranules, regex);

  // update granules object with final locations of files as `filename`
  const updatedResult = updateGranuleMetadata(allGranules, collection, cmrFiles, buckets);
  allGranules = updatedResult.granulesObject;
  const allFiles = updatedResult.allFiles;

  // allows us to disable moving the files
  if (moveStagedFiles) {
    // move files from staging location to final location
    await moveGranuleFiles(allGranules, bucket);

    // update cmr.xml files with correct online access urls
    updateCmrFileAccessURLs(cmrFiles, allGranules, allFiles, distEndpoint);
  }

  return {
    granules: Object.keys(allGranules).map((k) => {
      const granule = allGranules[k];

      // Just return the bucket name with the granules
      granule.files.map((f) => {
        f.bucket = f.bucket.name;
        return f;
      });

      return granule;
    })
  };
}

exports.moveGranules = moveGranules;

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(moveGranules, event, context, callback);
}

exports.handler = handler;
