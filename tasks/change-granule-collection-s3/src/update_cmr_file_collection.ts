import { AssertionError } from 'assert';
import { s3PutObject } from '@cumulus/aws-client/S3';
import {
  DistributionBucketMap,
  generateEcho10XMLString,
  isECHO10Filename,
  isUMMGFilename,
  setECHO10Collection,
  updateEcho10XMLMetadataObjectUrls,
  setUMMGCollection,
  updateUMMGMetadataObject,
} from '@cumulus/cmrjs/cmr-utils';
import { ApiFile, ApiGranuleRecord } from '@cumulus/types';
import { ValidationError } from '@cumulus/errors';
import {
  ValidApiFile,
  ValidGranuleRecord,
} from './types';

export function validateApiFile(file: Omit<ApiFile, 'granuleId'> | ApiFile): file is ValidApiFile {
  if (file.bucket === undefined || file.key === undefined) {
    throw new ValidationError(`file ${JSON.stringify(file)} is missing necessary key, bucket`);
  }

  return true;
}

export function validateApiGranuleRecord(granule: ApiGranuleRecord): granule is ValidGranuleRecord {
  if (!granule.files) {
    return true;
  }
  // this will throw if something is invalid
  granule.files.forEach(validateApiFile);
  return true;
}

export const CMRObjectToString = (
  cmrFile: Omit<ValidApiFile, 'granuleId'>,
  cmrObject: { Granule: object } | object
): string => {
  if (isUMMGFilename(cmrFile.key)) {
    return JSON.stringify(cmrObject, undefined, 2);
  }
  // our xml stringify function packages the metadata in "Granule",
  // resulting in possible nested Granule object
  if (!('Granule' in cmrObject)) {
    throw new ValidationError(
      `invalid ECHO10 cmr metadata ${JSON.stringify(cmrObject)}, must have granule tag`
    );
  }
  return generateEcho10XMLString(cmrObject.Granule);
};

export const uploadCMRFile = async (cmrFile: Omit<ValidApiFile, 'granuleId'>, cmrFileString: string) => {
  await s3PutObject({
    Bucket: cmrFile.bucket,
    Key: cmrFile.key,
    Body: cmrFileString,
  });
};
export const updateCmrFileLinks = ({
  cmrFileName,
  cmrObject,
  files,
  distEndpoint,
  bucketTypes,
  cmrGranuleUrlType = 'both',
  distributionBucketMap,
}: {
  cmrFileName: string,
  cmrObject: any,
  files: ValidApiFile[],
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
    return updateEcho10XMLMetadataObjectUrls({
      ...params,
      metadataObject: cmrObject,
    });
  }
  if (isUMMGFilename(cmrFileName)) {
    return updateUMMGMetadataObject({
      ...params,
      metadataObject: cmrObject,
    });
  }
  throw new AssertionError({ message: 'cmr file in unknown format' });
};
export const updateCmrFileCollection = ({
  collection,
  cmrFileName,
  cmrObject,
}: {
  collection: { name: string, version: string },
  cmrFileName: string,
  cmrObject: Object
}) => {
  if (isECHO10Filename(cmrFileName)) {
    return setECHO10Collection(cmrObject, collection);
  }
  if (isUMMGFilename(cmrFileName)) {
    return setUMMGCollection(cmrObject, collection);
  }
  throw new AssertionError({ message: 'cmr file in unknown format' });
};
