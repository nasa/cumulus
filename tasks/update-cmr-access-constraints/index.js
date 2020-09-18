'use strict';

const groupBy = require('lodash/groupBy');
const keyBy = require('lodash/keyBy');
const set = require('lodash/set');
const { buildS3Uri, parseS3Uri } = require('@cumulus/aws-client/S3');
const { runCumulusTask } = require('@cumulus/cumulus-message-adapter-js');
const { granulesToCmrFileObjects } = require('@cumulus/cmrjs');
const {
  generateEcho10XMLString,
  isCMRFile,
  isECHO10File,
  isUMMGFile,
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
 * Add etag to a CMR file object.
 *
 * @param {Object} file - CMR file record object
 * @param {Object} updatedFileMap - Map of CMR files by filename
 * @returns {Object} Updated CMR file record object
 */
function setCmrFileEtag(file, updatedFileMap) {
  const filename = file.filename || buildS3Uri(file.bucket, file.key);
  const updatedFile = updatedFileMap[filename];
  return updatedFile === undefined ? file : { ...file, etag: updatedFile.etag };
}

/**
 * Add etags to CMR file objects.
 *
 * @param {Array<Object>} originalFiles - Input list of CMR files
 * @param {Array<Object>} updatedFiles - List of CMR files updated by this task
 * @returns {Array<Object>} List of CMR files with updated etags
 */
function updateGranuleCmrFileObjects(originalFiles, updatedFiles) {
  const updatedFilesMap = keyBy(updatedFiles, 'filename');
  return originalFiles.map(
    (file) => (isCMRFile(file) ? setCmrFileEtag(file, updatedFilesMap) : file)
  );
}

/**
 * Reconcile task input granule with function CMR file outputs to create task output granule.
 *
 * @param {Object} input - Granule object task input
 * @param {Array<Object>} updatedCmrFileObjectsWithEtags - List of update CMR file objects
 * @returns {Object} Updated granule object
 */
function reconcileTaskOutput(input, updatedCmrFileObjectsWithEtags) {
  const mapOfUpdatedCmrFileObjects = groupBy(updatedCmrFileObjectsWithEtags, 'granuleId');
  return input.granules.map((granule) => (
    {
      ...granule,
      files: updateGranuleCmrFileObjects(
        granule.files,
        mapOfUpdatedCmrFileObjects[granule.granuleId]
      ),
    }));
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
 * @param {Object} accessConstraintsObject - Access Constraints config object
 * @param {number} accessConstraintsObject.value - Access constraint value
 * @param {string} [accessConstraintsObject.description] - Access constraint description
 * @returns {Object} CMR File Object with etag for updated CMR File
 */
async function updateCmrFileAccessConstraint(
  cmrFileObject,
  accessConstraintsObject
) {
  const cmrFileName = cmrFileObject.filename;
  const cmrMetadataContentsObject = await metadataObjectFromCMRFile(
    cmrFileName,
    cmrFileObject.etag
  );
  const { Bucket, Key } = parseS3Uri(cmrFileName);
  // ECHO10XML logic
  if (isECHO10File(cmrFileName)) {
    const updatedCmrMetadataContentsObject = setRestrictionMetadataInEcho10XMLMetadata(
      cmrMetadataContentsObject,
      accessConstraintsObject
    );
    const updatedGranuleXML = generateEcho10XMLString(updatedCmrMetadataContentsObject.Granule);
    const updatedCmrFile = await uploadEcho10CMRFile(
      updatedGranuleXML,
      { bucket: Bucket, key: Key }
    );
    return { ...cmrFileObject, etag: updatedCmrFile.ETag };
  }
  // UMMG-JSON logic
  if (isUMMGFile(cmrFileName)) {
    const updatedCmrMetadataContentsObject = setAccessConstraintMetadataInUMMGJSONMetadata(
      cmrMetadataContentsObject,
      accessConstraintsObject
    );
    const updatedCmrFile = await uploadUMMGJSONCMRFile(
      updatedCmrMetadataContentsObject,
      { bucket: Bucket, key: Key }
    );
    return { ...cmrFileObject, etag: updatedCmrFile.ETag };
  }
  throw new Error(`Unrecognized CMR File format: ${cmrFileName}`);
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
  const cmrFileObjects = granulesToCmrFileObjects(input.granules);
  const updatedCmrFileObjectsWithEtags = await Promise.all(
    cmrFileObjects.map(
      (cmrFileObject) => updateCmrFileAccessConstraint(cmrFileObject, config.accessConstraints)
    )
  );
  return { ...input, granules: reconcileTaskOutput(input, updatedCmrFileObjectsWithEtags) };
};

const handler = (event, context) => runCumulusTask(updateCmrAccessConstraints, event, context);

module.exports = {
  handler,
  updateCmrAccessConstraints,
};
