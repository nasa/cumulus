const get = require('lodash/get');
const isNil = require('lodash/isNil');
const jsyaml = require('js-yaml');
const paths = require('deepdash/paths');
const log = require('@cumulus/common/log');
const { s3 } = require('@cumulus/aws-client/services');
const { getObjectStreamContents } = require('@cumulus/aws-client/S3');

/**
 * get the bucket map yaml file from s3
 *
 * @param {string} bucket - bucket
 * @param {string} key - key
 * @returns {Promise<Object>} - bucket map object
 */
async function getYamlFile(bucket, key) {
  if (isNil(bucket) || isNil(key)) return {};

  try {
    log.info(`Attempting to download yaml ${bucket} ${key}`);
    const mapFile = await s3().getObject({
      Bucket: bucket,
      Key: key,
    });

    return jsyaml.load(await getObjectStreamContents(mapFile.Body));
  } catch (error) {
    log.error('Had trouble getting yaml file', error);
    throw new Error('Could not get yaml');
  }
}

/**
 * get the bucket map yaml file from configured s3 location
 *
 * @returns {Promise<Object>} - bucket map object
 */
const getBucketMap = () => getYamlFile(process.env.system_bucket, process.env.BUCKET_MAP_FILE);

const prependBucketName = (name) => {
  const prefix = process.env.BUCKETNAME_PREFIX || '';
  return `${prefix}${name}`;
};

const removePrefixBucketName = (name) => {
  const prefix = process.env.BUCKETNAME_PREFIX || '';
  return name.replace(new RegExp(`^${prefix}`), '');
};

/**
 * locate the bucket name and path from bucket map for the given paths
 *
 * @param {Array<string>} pathList - paths specified in the uri parameters
 *   e.g. ['path1', 'path2', 'filename']
 * @param {Object} bucketMap - bucket map object
 * @returns {Object} - file object information { bucket, path, key, headers }
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
    const bucketName = mappingObject.bucket || mappingObject;
    const headers = mappingObject.headers || {};

    const path = mapping.join('/');
    const key = pathList.join('/').replace(`${path}/`, '');
    log.info(`Bucket mapping was ${bucketName} ${path}, object was ${key}`);
    return { bucket: prependBucketName(bucketName), path, key, headers };
  }

  log.warn(`Unable to find bucket in bucket map for path ${pathList.join('/')}`);
  return {};
}

/**
 * process file request path by looking up the path in bucket map
 *
 * @param {string} uriPath - request path
 * @param {Object} bucketMap - bucket map object
 * @returns {Object} - file object information { bucket, path, key, headers }
 */
function processFileRequestPath(uriPath, bucketMap) {
  const pathParts = uriPath.replace(/^\//, '').split('/');
  // Make sure we got at least 1 path, and 1 file name
  if (pathParts.length < 2) return { path: pathParts };

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
 * @param {string} bucketToCheck - prefixed bucket to check
 * @param {string} bucketFromMap - bucket from the bucket map
 * @param {string} key - optional, object key
 * @returns {boolean} - whether the bucket matches the one from bucket map
 */
function bucketPrefixMatch(bucketToCheck, bucketFromMap, key = '') {
  if (bucketToCheck === bucketFromMap.split('/')[0] && key.startsWith(bucketFromMap.split('/').slice(1).join('/'))) {
    log.debug(`Prefixed Bucket Map matched: s3://${bucketToCheck}/${key} => ${bucketFromMap}`);
    return true;
  }
  return false;
}

/**
 * get the buckets for a given bucket group, and sort them so that
 * the buckets with object-prefixes are processed FIRST
 *
 * @param {Object} bucketMap - bucket map object
 * @param {string} bucketGroup - bucket group e.g. PUBLIC_BUCKETS
 * @returns {boolean} - whether the bucket matches the one from bucket map
 */
function getSortedBucketList(bucketMap, bucketGroup) {
  if (bucketMap[bucketGroup] === undefined) {
    log.warn(`Bucket map does not contain bucket group '${bucketGroup}`);
    return [];
  }

  // bucketMap[bucket_group] SHOULD be a dict, but list actually works too.
  if (Array.isArray(bucketMap[bucketGroup])) {
    return bucketMap[bucketGroup].sort((a1, a2) => a2.split('/').length - a1.split('/').length);
  }
  if (bucketMap[bucketGroup] instanceof Object) {
    return Object.keys(bucketMap[bucketGroup]).sort((a1, a2) => a2.split('/').length - a1.split('/').length);
  }

  return [];
}

/**
 * check if a bucket/object is private and returns the user groups which have access to this
 * bucket/object
 *
 * @param {Object} bucketMap - bucket map object
 * @param {string} bucket - bucket
 * @param {string} key - optinal, object key
 * @returns {Array<string>} - user groups for private bucket/object,
 *   undefined for non-private bucket/object
 */
function checkPrivateBucket(bucketMap, bucket, key = '') {
  log.debug(`check_private_buckets(): bucket: ${bucket}`);

  // Check private bucket file
  if (bucketMap.PRIVATE_BUCKETS) {
    // Prioritize prefixed buckets first, the deeper the better!
    const sortedBuckets = getSortedBucketList(bucketMap, 'PRIVATE_BUCKETS');
    //log.debug(`Sorted PRIVATE buckets are ${sortedBuckets}`);
    for (let i = 0; i < sortedBuckets.length; i += 1) {
      const privBucket = sortedBuckets[i];
      if (bucketPrefixMatch(bucket, prependBucketName(privBucket), key)) {
        // This bucket is PRIVATE, return group!
        return bucketMap.PRIVATE_BUCKETS[privBucket];
      }
    }
  }

  return undefined;
}

/**
 * check if a bucket/object is public
 *
 * @param {Object} bucketMap - bucket map object
 * @param {string} bucket - prefixed bucket to check
 * @param {string} key - optinal, object key
 * @returns {boolean} - whether the bucket/object is public
 */
function isPublicBucket(bucketMap, bucket, key = '') {
  // Check for PUBLIC_BUCKETS in bucket map file
  if (bucketMap.PUBLIC_BUCKETS) {
    const sortedBuckets = getSortedBucketList(bucketMap, 'PUBLIC_BUCKETS');
    //log.debug(`Sorted PUBLIC buckets are ${sortedBuckets}`);
    for (let i = 0; i < sortedBuckets.length; i += 1) {
      if (bucketPrefixMatch(bucket, prependBucketName(sortedBuckets[i]), key)) {
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

/**
 * get all paths from bucket map for a given bucket
 *
 * @param {Object} bucketMap - bucket map object
 * @param {string} bucket - bucket name w/o prefix
 * @returns {Array<string>} - list of paths
 */
function getPathsByBucketName(bucketMap, bucket) {
  const allMapPaths = paths(bucketMap.MAP, { pathFormat: 'array' });
  const pathStrings = allMapPaths
    .filter((p) => (get(bucketMap.MAP, p.join('.')) === bucket))
    .map((p) => {
      if (p[p.length - 1] === 'bucket') p.pop();
      return p.join('/');
    });
  return pathStrings;
}

/**
 * get all paths from bucket map for a given bucket
 *
 * @param {Object} bucketMap - bucket map object
 * @param {string} prependBucket - bucket name with prefix
 * @returns {Array<string>} - list of paths
 */
const getPathsByPrefixedBucketName = (bucketMap, prependBucket) =>
  getPathsByBucketName(bucketMap, removePrefixBucketName(prependBucket));

module.exports = {
  checkPrivateBucket,
  getBucketMap,
  getBucketDynamicPath,
  getPathsByBucketName,
  getPathsByPrefixedBucketName,
  isPublicBucket,
  processFileRequestPath,
};
