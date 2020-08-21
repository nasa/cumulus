'use strict';

const groupBy = require('lodash/groupBy');
const { parseS3Uri } = require('@cumulus/aws-client/S3');
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

function isSameCmrFileObject(file, updatedFile) {
  if (file.filename) return file.filename === updatedFile.filename;
  return file.key === parseS3Uri(updatedFile.filename).Key;
}

function updateGranuleCmrFileObjects(originalFiles, updatedFiles) {
  updatedFiles.forEach((updatedFile) => {
    originalFiles.filter(isCMRFile).forEach((file) => {
      if (isSameCmrFileObject(file, updatedFile)) {
        // eslint-disable-next-line no-param-reassign
        file.etag = updatedFile.etag;
      }
    });
  });
  return originalFiles;
}

function reconcileOutputs(input, updatedCmrFileObjectsWithEtags) {
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

function setAccessConstraintValueInEcho10XMLMetadata(
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

function setAccessConstraintValueInUMMGJSONMetadata(
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
    const updatedCmrMetadataContentsObject = setAccessConstraintValueInEcho10XMLMetadata(
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
    const updatedCmrMetadataContentsObject = setAccessConstraintValueInUMMGJSONMetadata(
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
    cmrFileObjects.map((f) => updateCmrFileAccessConstraint(f, config.accessConstraints))
  );
  return { ...input, granules: reconcileOutputs(input, updatedCmrFileObjectsWithEtags) };
};

const handler = (event, context) => runCumulusTask(updateCmrAccessConstraints, event, context);

module.exports = {
  handler,
  updateCmrAccessConstraints,
};
