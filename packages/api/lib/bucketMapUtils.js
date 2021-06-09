const get = require('lodash/get');
const isNil = require('lodash/isNil');
const jsyaml = require('js-yaml');
const paths = require('deepdash/paths');
const log = require('@cumulus/common/log');
const { s3 } = require('@cumulus/aws-client/services');

async function getYamlFile(bucket, key) {
  if (isNil(bucket) || isNil(key)) {
    return {};
  }

  try {
    log.info(`Attempting to download yaml ${bucket} ${key}`);
    const mapFile = await s3().getObject({
      Bucket: bucket,
      Key: key,
    }).promise();

    const bucketMap = jsyaml.load(mapFile.Body.toString());
    return bucketMap;
  } catch (error) {
    log.error('Had trouble getting yaml file', error);
    throw new Error('Could not get yaml');
  }
}

function getBucketMap() {
  return getYamlFile(process.env.system_bucket, process.env.BUCKET_MAP_FILE);
}

function prependBucketname(name) {
  const prefix = process.env.BUCKETNAME_PREFIX || '';
  return `${prefix}${name}`;
}

/**
 * locate the bucket name and path from bucket map for the given paths
 *
 * @param {Array} pathList - paths specified in the uri parameters e.g. path1/path2/file
 * @param {Object} bucketMap - bucket map object
 * @returns {Object} TODO
 */
function getBucketDynamicPath(pathList, bucketMap) {
  log.debug(`Pathparts is ${pathList.join(',')}`);

  // get bucket map paths which matches the path list,
  // and sort from longest path to shortest one
  const allMapPaths = paths(bucketMap.MAP, { pathFormat: 'array' });
  const mappings = allMapPaths
    .filter((p) => {
      if (p[p.length - 1] === 'bucket') p.pop();
      return pathList.join('/').startsWith(`${p.join('/')}/`);
    })
    .sort((a1, a2) => a2.length - a1.length);

  if (mappings.length >= 1) {
    const mapping = mappings[0];
    const mappingObject = get(bucketMap.MAP, mapping.join('.'));
    const bucketname = mappingObject.bucket || mappingObject;
    const headers = mappingObject.headers || {};

    const path = mapping.join('/');
    const key = pathList.join('/').replace(`${path}/`, '');
    log.info(`Bucket mapping was ${path}, object was ${key}`);
    return { bucket: prependBucketname(bucketname), path, key, headers };
  }

  log.warn(`Unable to find bucket in bucket map for path ${pathList.join('/')}`);
  return {};
}

// path, bucket, object_name, headers
function processRequest(uriPath, bucketMap) {
  const pathParts = uriPath.split('/');
  // Make sure we got at least 1 path, and 1 file name
  if (pathParts.length < 2) {
    return { path: pathParts };
  }

  // Look up the bucket from path parts
  const { bucket, path, key, headers } = getBucketDynamicPath(pathParts, bucketMap);
  if (bucket === undefined) {
    return { key: pathParts.pop(), path: pathParts.join('/') };
  }

  return { bucket, path, key, headers };
}

/**
 * Check if a given bucket matches the bucket from bucket map
 *
 * @param {string} bucketToCheck - bucket to check
 * @param {string} bucketFromMap - bucket from the bucket map
 * @param {string} key - optional, object key
 * @returns {boolean} - whether the bucket matches the one from bucket map
 */
function bucketPrefixMatch(bucketToCheck, bucketFromMap, key = '') {
  log.debug(`bucket_prefix_match(): checking if ${bucketToCheck} matches ${bucketFromMap} w/ optional obj ${key}`);
  if (bucketToCheck === bucketFromMap.split('/')[0] && key.startsWith(bucketFromMap.split('/').slice(1).join('/'))) {
    log.debug(`Prefixed Bucket Map matched: s3://${bucketToCheck}/{object_name} => ${bucketFromMap}`);
    return true;
  }
  return false;
}

// Sort public/private buckets such that object-prefixes are processed FIRST
function getSortedBucketList(bucketMap, bucketGroup) {
  if (bucketMap[bucketGroup] === undefined) {
    log.warn(`Bucket map does not contain bucket group '${bucketGroup}`);
    return [];
  }

  // b_map[bucket_group] SHOULD be a dict, but list actually works too.
  if (Array.isArray(bucketMap[bucketGroup])) {
    return bucketMap[bucketGroup].sort((a1, a2) => a2.split('/').length - a1.split('/').length);
  }
  if (bucketMap[bucketGroup] instanceof Object) {
    return Object.keys(bucketMap[bucketGroup]).sort((a1, a2) => a2.split('/').length - a1.split('/').length);
  }

  return [];
}

function checkPrivateBucket(bucket, bucketMap, object_name = '') {
  log.debug(`check_private_buckets(): bucket: ${bucket}`);

  // Check private bucket file
  if (bucketMap.PRIVATE_BUCKETS) {
    // Prioritize prefixed buckets first, the deeper the better!
    const sortedBuckets = getSortedBucketList(bucketMap, 'PRIVATE_BUCKETS');
    //log.debug(`Sorted PRIVATE buckets are ${sortedBuckets}`);
    for (let i = 0; i < sortedBuckets.length; i += 1) {
      const privBucket = sortedBuckets[i];
      if (bucketPrefixMatch(bucket, prependBucketname(privBucket), object_name)) {
        // This bucket is PRIVATE, return group!
        return bucketMap.PRIVATE_BUCKETS[privBucket];
      }
    }
  }

  return [];
}

function checkPublicBucket(bucket, bucketMap, object_name = '') {
  // Check for PUBLIC_BUCKETS in bucket map file
  if (bucketMap.PUBLIC_BUCKETS) {
    const sortedBuckets = getSortedBucketList(bucketMap, 'PUBLIC_BUCKETS');
    //log.debug(`Sorted PUBLIC buckets are ${sortedBuckets}`);
    for (let i = 0; i < sortedBuckets.length; i += 1) {
      if (bucketPrefixMatch(bucket, prependBucketname(sortedBuckets[i]), object_name)) {
        // This bucket is public!
        log.debug('found a public, we will take it');
        return true;
      }
    }
  }

  // Did not find this in public bucket list
  log.debug(`we did not find a public bucket for ${bucket}`);
  return false;
}

function getPathsByBucketName(bucket, bucketMap) {
  const allMapPaths = paths(bucketMap.MAP, { pathFormat: 'array' });
  const pathStrings = allMapPaths
    .filter((p) => (get(bucketMap.MAP, p.join('.')) === bucket))
    .map((p) => {
      if (p[p.length - 1] === 'bucket') p.pop();
      return p.join('/');
    });
  return pathStrings;
}

module.exports = {
  checkPrivateBucket,
  checkPublicBucket,
  getBucketMap,
  getBucketDynamicPath,
  getPathsByBucketName,
  processRequest,
};
