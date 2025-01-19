import { isECHO10Filename, isISOFilename, isUMMGFilename } from '@cumulus/cmrjs/cmr-utils';
import { CollectionRecord } from '@cumulus/types';
import { AssertionError } from 'assert';
import get from 'lodash/get';
import set from 'lodash/set';
import xml2js from 'xml2js';

const findCollectionAttributePath = (cmrObject: Object, attributePath: string) => {
  if (get(cmrObject, attributePath)) {
    return attributePath;
  } else {
    let output = null
    Object.entries(cmrObject).forEach(([key, value]) => {
      if (typeof (value) === 'object') {
        const path = findCollectionAttributePath(value, attributePath);
        if (path !== null) {
          output = key + '.' + path;
        }
      }
    });
    return output;
  }
}

const updateCMRISOCollectionValue = (
  cmrObject: Object,
  collection: CollectionRecord,
) => {
  const defaultNamePath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString'
  const fullNamePath = findISOCollectionAttributePath(cmrObject, 'The ECS Short Name') || defaultNamePath;
  set(cmrObject, fullNamePath, collection.name)

  const defaultIdPath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString'
  const fullIdPath = findISOCollectionAttributePath(cmrObject, 'The ECS Version ID') || defaultIdPath;
  set(cmrObject, fullIdPath, collection.version)
}

const findISOCollectionAttributePath = (cmrObject: Object, identifierString: string) => {
  if (get(cmrObject, 'gmd:description.gco:CharacterString') === identifierString) {
    return 'gmd:code.gco:CharacterString';
  } else {
    let output = null
    Object.entries(cmrObject).forEach(([key, value]) => {
      if (typeof (value) === 'object') {
        const path = findISOCollectionAttributePath(value, identifierString);
        if (path !== null) {
          output = key + '.' + path;
        }
      }
    });
    return output;
  }
}

const updateCMRCollectionValue = (
  cmrObject: Object,
  identifierPath: string,
  value: string,
  defaultPath: string | null = null,
) => {
  const _defaultPath = defaultPath || identifierPath
  const fullPath = findCollectionAttributePath(cmrObject, identifierPath) || _defaultPath;
  set(cmrObject, fullPath, value)
}

export const update_cmr_file_collections = (
  collection: CollectionRecord,
  cmrFileName: string,
  cmrObject: object
) => {
  if (isECHO10Filename(cmrFileName)) {
    updateCMRCollectionValue(cmrObject, 'Collection.ShortName', collection.name, 'Granule.Collection.ShortName');
    updateCMRCollectionValue(cmrObject, 'Collection.VersionId', collection.version, 'Granule.Collection.VersionId');
  } else if (isISOFilename(cmrFileName)) {
    updateCMRISOCollectionValue(cmrObject, collection);
  } else if (isUMMGFilename(cmrFileName)) {
    updateCMRCollectionValue(cmrObject, 'CollectionReference.ShortName', collection.name);
    updateCMRCollectionValue(cmrObject, 'CollectionReference.VersionId', collection.version);
  } else {
    throw new AssertionError({ message: 'not good' });
  }
}

function groupChildren(obj: { [key: string]: any }) {
  if (typeof(obj) === 'object') {
    for (const prop in Object.keys(obj)) { // consider filtering for own properties (vs from prototype: for(prop of Object.keys(obj)) {
      groupChildren(obj[prop])
    }
  }
  
  return obj;
}


export function convertJSON2XML(obj: Object) {
  const  builder = new xml2js.Builder();
  return builder.buildObject(groupChildren(obj));
}
