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

function setCmrFileEtag(file, updatedFileMap) {
  const filename = file.filename || buildS3Uri(file.bucket, file.key);
  const updatedFile = updatedFileMap[filename];
  return updatedFile === undefined ? file : { ...file, etag: updatedFile.etag };
}

function updateGranuleCmrFileObjects(originalFiles, updatedFiles) {
  const updatedFilesMap = keyBy(updatedFiles, 'filename');
  return originalFiles.map(
    (file) => (isCMRFile(file) ? setCmrFileEtag(file, updatedFilesMap) : file)
  );
}

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
