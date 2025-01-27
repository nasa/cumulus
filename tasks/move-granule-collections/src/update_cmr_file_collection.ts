import { s3PutObject } from '@cumulus/aws-client/S3';
import { CMR, CMRConstructorParams } from '@cumulus/cmr-client/CMR';
import {
  generateEcho10XMLString,
  getCmrSettings,
  isECHO10Filename,
  isISOFilename,
  isUMMGFilename,
  metadataObjectFromCMRFile,
  updateEcho10XMLMetadataObject,
  updateUMMGMetadataObject,
} from '@cumulus/cmrjs/cmr-utils';
import { ApiFile, ApiGranuleRecord, CollectionRecord } from '@cumulus/types';
import { AssertionError } from 'assert';
import cloneDeep from 'lodash/cloneDeep';
import get from 'lodash/get';
import set from 'lodash/set';
// import xml2js from 'xml2js';

export interface ValidApiFile extends ApiFile {
  bucket: string,
  key: string
}

export interface ValidGranuleRecord extends ApiGranuleRecord {
  files: Omit<ValidApiFile, 'granuleId'>[]
}

function apiFileIsValid(file: Omit<ApiFile, 'granuleId'> | ApiFile): file is ValidApiFile {
  if (file.bucket === undefined || file.key === undefined) {
    return false;
  }
  return true;
}

export function apiGranuleRecordIsValid(granule: ApiGranuleRecord): granule is ValidGranuleRecord {
  if(!granule.files) {
    return true;
  }
  let filesAreValid = true;
  granule.files.forEach((file) => {if(!apiFileIsValid(file)) filesAreValid = false})
  return filesAreValid;
}

const findCollectionAttributePath = (cmrObject: Object, attributePath: string) => {
  if (get(cmrObject, attributePath)) {
    return attributePath;
  }
  let output = null;
  Object.entries(cmrObject).forEach(([key, value]) => {
    if (typeof (value) === 'object') {
      const path = findCollectionAttributePath(value, attributePath);
      if (path !== null) {
        output = key + '.' + path;
      }
    }
  });
  return output;
};

const findISOCollectionAttributePath = (cmrObject: Object, identifierString: string) => {
  if (get(cmrObject, 'gmd:description.gco:CharacterString') === identifierString) {
    return 'gmd:code.gco:CharacterString';
  }
  let output = null;
  Object.entries(cmrObject).forEach(([key, value]) => {
    if (typeof (value) === 'object') {
      const path = findISOCollectionAttributePath(value, identifierString);
      if (path !== null) {
        output = key + '.' + path;
      }
    }
  });
  return output;
};

const updateCMRISOCollectionValue = (
  cmrObject: Object,
  collection: CollectionRecord
) => {
  const defaultNamePath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString';
  const fullNamePath = findISOCollectionAttributePath(cmrObject, 'The ECS Short Name') || defaultNamePath;
  set(cmrObject, fullNamePath, collection.name);

  const defaultIdPath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString';
  const fullIdPath = findISOCollectionAttributePath(cmrObject, 'The ECS Version ID') || defaultIdPath;
  set(cmrObject, fullIdPath, collection.version);
};

const updateCMRCollectionValue = (
  cmrObject: Object,
  identifierPath: string,
  value: string,
  defaultPath: string | null = null
) => {
  const backupPath = defaultPath || identifierPath;
  const fullPath = findCollectionAttributePath(cmrObject, identifierPath) || backupPath;
  set(cmrObject, fullPath, value);
};

export const uploadCMRFile = async (cmrFile: Omit<ValidApiFile, 'granuleId'>, cmrObject: Object) => {
  let cmrFileString;
  if (isUMMGFilename(cmrFile.name || cmrFile.key)) {
    cmrFileString = JSON.stringify(cmrObject, undefined, 2);
  } else {
    cmrFileString = generateEcho10XMLString(cmrObject)
  }
  await s3PutObject({
    Bucket: cmrFile.bucket,
    Key: cmrFile.key,
    Body: cmrFileString,
  })
}

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
  collection: CollectionRecord,
  cmrFileName: string,
  cmrObject: Object
  files: Array<Omit<ValidApiFile, 'granuleId'>>,
  distEndpoint: string,
  bucketTypes: Object,
  cmrGranuleUrlType: string
  distributionBucketMap: Object
}
) => {
  
  const cmrObjectCopy = cloneDeep(cmrObject)
  const params = {
    metadataObject: cmrObjectCopy,
    files,
    distEndpoint,
    bucketTypes,
    cmrGranuleUrlType,
    distributionBucketMap
  }
  if (isECHO10Filename(cmrFileName)) {
    updateCMRCollectionValue(cmrObjectCopy, 'Collection.ShortName', collection.name, 'Granule.Collection.ShortName');
    updateCMRCollectionValue(cmrObjectCopy, 'Collection.VersionId', collection.version, 'Granule.Collection.VersionId');
    updateEcho10XMLMetadataObject(params)
  } else if (isISOFilename(cmrFileName)) {
    updateCMRISOCollectionValue(cmrObjectCopy, collection);
  } else if (isUMMGFilename(cmrFileName)) {
    updateCMRCollectionValue(cmrObjectCopy, 'CollectionReference.ShortName', collection.name);
    updateCMRCollectionValue(cmrObjectCopy, 'CollectionReference.VersionId', collection.version);
    updateUMMGMetadataObject(params)
  } else {
    throw new AssertionError({ message: 'cmr file in unknown format' });
  }
  return cmrObjectCopy;
};

export const getCMRMetadata = async (cmrFile: ValidApiFile, granuleId: string): Promise<Object> => {
  try {
    return metadataObjectFromCMRFile(`s3://${cmrFile.bucket}/${cmrFile.key}`);
  } catch {
    const cmrSettings: CMRConstructorParams = await getCmrSettings();
    const cmr = new CMR(cmrSettings);
    const [granulesOutput] = await cmr.searchGranules({ granuleId }) as Array<Object>;
    return granulesOutput;
  }
}
export function isCMRMetadataFile(file: ApiFile | Omit<ApiFile, 'granuleId'>): boolean {
  return file.type === 'metadata';
}
