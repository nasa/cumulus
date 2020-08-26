'use strict';

const groupBy = require('lodash/groupBy');
const keyBy = require('lodash/keyBy');
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
  const { description, value } = accessConstraintsObject;
  const echo10AccessConstraintsObject = {
    RestrictionComment: description !== undefined ? description : 'None',
    RestrictionFlag: value,
  };
  const updatedGranule = Object.assign(
    echo10AccessConstraintsObject,
    echo10XMLMetadataContentsObject.Granule
  );
  return { ...echo10XMLMetadataContentsObject, Granule: updatedGranule };
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
