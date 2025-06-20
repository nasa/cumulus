//@ts-check

// Imported for JSDoc typedef
// eslint-disable-next-line no-unused-vars
const BucketsConfig = require('@cumulus/common/BucketsConfig');

/**
 * @typedef {InstanceType<typeof BucketsConfig>} BucketsConfigType
 * @typedef {import('@cumulus/types/api/granules').ApiGranule} ApiGranule
 * @typedef {import('@cumulus/types/api/collections').PartialCollectionRecord} ApiCollection
 * @typedef {import('@cumulus/types').DuplicateHandling} DuplicateHandling
 */

/**
 * @typedef {object} MoveGranulesFile
 * @property {string} bucket - S3 bucket name
 * @property {string} key - S3 key
 * @property {string} [sourceKey] - Original source key before move
 * @property {string} [fileName] - File name
 * @property {number} [size] - File size
 * @property {string} [type] - File type
 * @property {boolean} [duplicate_found] - Whether a duplicate was found
 */

/**
 * @typedef {MoveGranulesFile & {sourceKey: string}} MoveGranulesFileWithSourceKey
 */

/**
 * @typedef {object} MoveGranulesGranule
 * @property {string} granuleId - Granule ID
 * @property {string} [producerGranuleId] - Producer granule ID
 * @property {string} [dataType] - Data type
 * @property {string} [version] - Version
 * @property {Array<MoveGranulesFileWithSourceKey>} files - Granule files
 */

/**
 * @typedef {object} MoveGranulesGranuleOptionalFilesFields
 * @property {string} granuleId - Granule ID
 * @property {string} [producerGranuleId] - Producer granule ID
 * @property {string} [dataType] - Data type
 * @property {string} [version] - Version
 * @property {Array<MoveGranulesFile>} files - Granule files
 */

/**
 * @typedef {Object.<string, MoveGranulesGranule>} GranulesObject
 * @typedef {Object.<string, MoveGranulesGranuleOptionalFilesFields>} GranulesOutputObject
 */

/**
 * @typedef {object} CollectionFile
 * @property {string} regex - Regular expression to match file
 * @property {string} bucket - Bucket to store file
 * @property {string} [url_path] - URL path template
 */

/**
 * @typedef {object} Collection
 * @property {string} [name] - Collection name
 * @property {string} [version] - Collection version
 * @property {string} [url_path] - Default URL path template
 * @property {DuplicateHandling} [duplicateHandling] - Duplicate handling option
 * @property {Array<CollectionFile>} files - File specifications
 */

/**
 * @typedef {object} S3Object
 * @property {string} Bucket - S3 bucket name
 * @property {string} Key - S3 object key
 * @property {number} [size] - object size
 */

/**
 * @typedef {object} GranuleFileInfo
 * @property {string} granuleId - The ID of the granule found for the file
 * @property {string | null | undefined} [collectionId] - The ID of the
 * collection associated with the file
 */

module.exports = {};
