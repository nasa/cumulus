import { s3PutObject } from '@cumulus/aws-client/S3';
import {
  DistributionBucketMap,
  generateEcho10XMLString,
  isECHO10Filename,
  isUMMGFilename,
  updateECHO10Collection,
  updateEcho10XMLMetadataObject,
  updateUMMGCollection,
  updateUMMGMetadataObject,
} from '@cumulus/cmrjs/cmr-utils';
import { ApiFile, ApiGranuleRecord } from '@cumulus/types';
import { AssertionError } from 'assert';

export type ValidApiFile = {
  bucket: string,
  key: string
} & ApiFile;

export type ValidGranuleRecord = {
  files: Omit<ValidApiFile, 'granuleId'>[]
} & ApiGranuleRecord;

function apiFileIsValid(file: Omit<ApiFile, 'granuleId'> | ApiFile): file is ValidApiFile {
  if (file.bucket === undefined || file.key === undefined) {
    return false;
  }
  return true;
}

export function apiGranuleRecordIsValid(granule: ApiGranuleRecord): granule is ValidGranuleRecord {
  if (!granule.files) {
    return true;
  }
  let filesAreValid = true;
  granule.files.forEach((file) => { if (!apiFileIsValid(file)) filesAreValid = false; });
  return filesAreValid;
}

export const uploadCMRFile = async (cmrFile: Omit<ValidApiFile, 'granuleId'>, cmrObject: { Granule?: object }) => {
  let cmrFileString;
  if (isUMMGFilename(cmrFile.fileName || cmrFile.key)) {
    cmrFileString = JSON.stringify(cmrObject, undefined, 2);
  } else {
    // our xml stringify function packages the metadata in "Granule",
    // resulting in possible nested Granule object
    cmrFileString = generateEcho10XMLString(cmrObject.Granule || cmrObject);
  }
  await s3PutObject({
    Bucket: cmrFile.bucket,
    Key: cmrFile.key,
    Body: cmrFileString,
  });
};

export const updateCmrFileCollections = ({
  collection,
  cmrFileName,
  cmrObject,
  files,
  distEndpoint,
  bucketTypes,
  cmrGranuleUrlType = 'both',
  distributionBucketMap,
}: {
  collection: { name: string, version: string },
  cmrFileName: string,
  cmrObject: Object
  files: Array<Omit<ValidApiFile, 'granuleId'>>,
  distEndpoint: string,
  bucketTypes: { [key: string]: string },
  cmrGranuleUrlType: string
  distributionBucketMap: DistributionBucketMap
}) => {
  const params = {
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap,
  };
  if (isECHO10Filename(cmrFileName)) {
    const updatedObject = updateECHO10Collection(cmrObject, collection);
    return updateEcho10XMLMetadataObject({
      ...params,
      metadataObject: updatedObject,
    });
  }
  if (isUMMGFilename(cmrFileName)) {
    const updatedObject = updateUMMGCollection(cmrObject, collection);
    return updateUMMGMetadataObject({
      ...params,
      metadataObject: updatedObject,
    });
  }
  throw new AssertionError({ message: 'cmr file in unknown format' });
};

export function isCMRMetadataFile(file: ApiFile | Omit<ApiFile, 'granuleId'>): boolean {
  return file.type === 'metadata';
}
