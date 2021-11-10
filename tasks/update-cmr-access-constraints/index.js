'use strict';

const set = require('lodash/set');
const { parseS3Uri } = require('@cumulus/aws-client/S3');
const { runCumulusTask } = require('@cumulus/cumulus-message-adapter-js');
const { granulesToCmrFileObjects } = require('@cumulus/cmrjs');
const {
  generateEcho10XMLString,
  getS3UrlOfFile,
  mapFileEtags,
  isECHO10Filename,
  isUMMGFilename,
  metadataObjectFromCMRFile,
  uploadEcho10CMRFile,
  uploadUMMGJSONCMRFile,
} = require('@cumulus/cmrjs/cmr-utils');

/**
 * Generate an update Echo10XML Metadata Object populated with restriction fields.
 *
 * Echo10XML is sensitive to key ordering as it uses <sequence> in the schema.
 * See the public Echo10 granule schema at:
 * https://git.earthdata.nasa.gov/projects/EMFD/repos/echo-schemas/browse/schemas/10.0/Granule.xsd
 * For this reason, we need to generate an XML with the keys in the right place.
 * This requires creating a partial sequence that we can append the restriction fields to,
 * and merging that with the remaining metadata.
 * There is special consideration given to every element that precedes the
 * `RestrictionFlag` and `RestrictionComment elements in the code below.
 *
 * @param {Object} metadataGranule - Original CMR Metadata object
 * @param {Object} accessConstraintsObject - Access constraints config object
 * @param {number} accessConstraintsObject.value - Access constraint value
 * @param {string} [accessConstraintsObject.description] - Access constraint description
 * @returns {Object} Updated CMR Metadata object with Restriction fields set
 */
function createUpdatedEcho10XMLMetadataGranuleCopy(metadataGranule, accessConstraintsObject) {
  const { description, value } = accessConstraintsObject;
  const metadataGranuleCopy = { ...metadataGranule };
  // create partial metadata sequence as per Echo10 Granule XSD.
  const granuleUpdateSequence = {
    GranuleUR: metadataGranule.GranuleUR,
    InsertTime: metadataGranule.InsertTime,
    LastUpdate: metadataGranule.LastUpdate,
  };
  delete metadataGranuleCopy.GranuleUR;
  delete metadataGranuleCopy.InsertTime;
  delete metadataGranuleCopy.LastUpdate;
  const deleteTime = metadataGranule.DeleteTime;
  if (deleteTime !== undefined) {
    set(granuleUpdateSequence, 'DeleteTime', deleteTime);
    delete metadataGranuleCopy.deleteTime;
  }
  set(granuleUpdateSequence, 'Collection', metadataGranule.Collection);
  delete metadataGranuleCopy.Collection;
  set(granuleUpdateSequence, 'RestrictionFlag', value);
  delete metadataGranuleCopy.RestrictionFlag;
  set(granuleUpdateSequence, 'RestrictionComment', description !== undefined ? description : 'None');
  delete metadataGranuleCopy.RestrictionComment;
  // append remaining original metadata to partial metadata sequence
  return {
    ...granuleUpdateSequence,
    ...metadataGranuleCopy,
  };
}

/**
 * Use accessConstraintsObject values to set RestrictionFlag and RestrictionComment in
 * echo10XMLMetadataContentsObject.
 *
 * @param {Object} echo10XMLMetadataContentsObject - JSON representation of ECHO10XML metadata
 * @param {Object} accessConstraintsObject - Access Constraints config object
 * @param {number} accessConstraintsObject.value - Access constraint value
 * @param {string} [accessConstraintsObject.description] - Access constraint description
 * @returns {Updated} Updated echo10XMLMetadataContentsObject
 */
function setRestrictionMetadataInEcho10XMLMetadata(
  echo10XMLMetadataContentsObject,
  accessConstraintsObject
) {
  const metadataGranule = echo10XMLMetadataContentsObject.Granule;
  const updatedMetadataGranule = createUpdatedEcho10XMLMetadataGranuleCopy(
    metadataGranule,
    accessConstraintsObject
  );
  return { ...echo10XMLMetadataContentsObject, Granule: updatedMetadataGranule };
}

/**
 * Use accessConstraintsObject values to set AccessConstraints.Value and
 * AccessConstraints.Description in UMMGJSONMetadataContentsObject.
 *
 * @param {Object} UMMGJSONMetadataContentsObject - UMMG-JSON metadata object
 * @param {Object} accessConstraintsObject - Access Constraints config object
 * @param {number} accessConstraintsObject.value - Access constraint value
 * @param {string} [accessConstraintsObject.description] - Access constraint description
 * @returns {Object} Updated UMMGJSONMetadataContentsObject
 */
function setAccessConstraintMetadataInUMMGJSONMetadata(
  UMMGJSONMetadataContentsObject,
  accessConstraintsObject
) {
  const { description, value } = accessConstraintsObject;
  const UMMGAccessConstraintsObject = {
    Description: description !== undefined ? description : 'None',
    Value: value,
  };
  return { ...UMMGJSONMetadataContentsObject, AccessConstraints: UMMGAccessConstraintsObject };
}

/**
 * Update access constraints within CMR Metadata.
 *
 * @param {Object} cmrFileObject - CMR File Object from granule record
 * @param {Object} etags - map of s3Uris to ETags
 * @param {Object} accessConstraints - access constraints config object
 * @param {number} accessConstraints.value - Access constraint value
 * @param {string} [accessConstraints.description] - Access constraint description
 * @returns {Object} CMR File Object with etag for updated CMR File
 */
async function updateCmrFileAccessConstraint(
  cmrFileObject,
  etags,
  accessConstraints
) {
  const cmrS3Url = getS3UrlOfFile(cmrFileObject);
  const cmrMetadataContentsObject = await metadataObjectFromCMRFile(
    cmrS3Url,
    etags[cmrS3Url]
  );
  const { Bucket, Key } = parseS3Uri(cmrS3Url);
  // ECHO10XML logic
  if (isECHO10Filename(cmrS3Url)) {
    const updatedCmrMetadataContentsObject = setRestrictionMetadataInEcho10XMLMetadata(
      cmrMetadataContentsObject,
      accessConstraints
    );
    const updatedGranuleXML = generateEcho10XMLString(updatedCmrMetadataContentsObject.Granule);
    const updatedCmrFile = await uploadEcho10CMRFile(
      updatedGranuleXML,
      { bucket: Bucket, key: Key }
    );
    return { ...cmrFileObject, etag: updatedCmrFile.ETag };
  }
  // UMMG-JSON logic
  if (isUMMGFilename(cmrS3Url)) {
    const updatedCmrMetadataContentsObject = setAccessConstraintMetadataInUMMGJSONMetadata(
      cmrMetadataContentsObject,
      accessConstraints
    );
    const updatedCmrFile = await uploadUMMGJSONCMRFile(
      updatedCmrMetadataContentsObject,
      { bucket: Bucket, key: Key }
    );
    return { ...cmrFileObject, etag: updatedCmrFile.ETag };
  }
  throw new Error(`Unrecognized CMR File format: ${cmrS3Url}`);
}

/**
 * Update Access Constraints in CMR Files for granule record in input.
 *
 * @param {Object} event - AWS Lambda payload
 * @param {Object} event.input - task input
 * @param {Array<Object>} event.input.granules - list of granule records
 * @param {Object} event.config - task config
 * @param {Object} event.config.accessConstraints - access constraints value & description config
 * @param {number} event.config.accessConstraints.value - access constraint value
 * @param {string} [event.config.accessConstraints.description] - access constraint description
 * @returns {Object} Input object with updated granules
 */
const updateCmrAccessConstraints = async (event) => {
  const { config, input } = event;
  const { etags = {}, accessConstraints } = config;

  const cmrFileObjects = granulesToCmrFileObjects(input.granules);
  const updatedCmrFileObjectsWithEtags = await Promise.all(
    cmrFileObjects.map(
      (cmrFileObject) => updateCmrFileAccessConstraint(cmrFileObject, etags, accessConstraints)
    )
  );

  return {
    ...input,
    etags: {
      ...etags,
      ...mapFileEtags(updatedCmrFileObjectsWithEtags),
    },
  };
};

const handler = (event, context) => runCumulusTask(updateCmrAccessConstraints, event, context);

module.exports = {
  handler,
  updateCmrAccessConstraints,
};
