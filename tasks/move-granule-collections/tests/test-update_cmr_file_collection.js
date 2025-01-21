const { xmlParseOptions } = require('@cumulus/cmrjs/utils');
const xml2js = require('xml2js');
const test = require('ava');
const fs = require('fs');
const get = require('lodash/get');
const { promisify } = require('util');
const { updateCmrFileCollections } = require('../dist/src/update_cmr_file_collection');

test('updateCmrFileCollections updates Echo10Files', async (t) => {
  const filename = 'tests/data/meta.cmr.xml';
  const cmrObject = await promisify(xml2js.parseString)(fs.readFileSync(filename, 'utf-8'), xmlParseOptions);
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);

  t.is(cmrObject.Granule.Collection.ShortName, 'a');
  t.is(cmrObject.Granule.Collection.VersionId, 'b');
});

test('updateCmrFileCollections updates Echo10Files at non-standard locations', (t) => {
  const filename = 'meta.cmr.xml';
  const cmrObject = {
    Granule: {
      GranuleUR: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      InsertTime: '2017-11-20T23:02:40.055807',
      LastUpdate: '2017-11-20T23:02:40.055814',
      WhyThisAttribute: {
        Collection: {
          ShortName: 'MOD11A1',
          VersionId: '006',
        },
      },
    },
  };
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);
  t.is(cmrObject.Granule.WhyThisAttribute.Collection.ShortName, 'a');
  t.is(cmrObject.Granule.WhyThisAttribute.Collection.VersionId, 'b');
});

test('updateCmrFileCollections updates Echo10Files when missing', (t) => {
  const filename = 'meta.cmr.xml';
  const cmrObject = {};
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);
  t.is(cmrObject.Granule.Collection.ShortName, 'a');
  t.is(cmrObject.Granule.Collection.VersionId, 'b');
});

test('updateCmrFileCollections updates umm meta file', (t) => {
  const filename = 'tests/data/ummg-meta.cmr.json';
  const cmrObject = JSON.parse(fs.readFileSync(filename, 'utf-8'));
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);

  t.is(cmrObject.CollectionReference.ShortName, 'a');
  t.is(cmrObject.CollectionReference.VersionId, 'b');
});

test('updateCmrFileCollections updates umm at non-standard locations', (t) => {
  const filename = 'ummg-meta.cmr.json';
  const cmrObject = {
    Granule: {
      GranuleUR: 'MOD11A1.A2017200.h19v04.006.2017201090724',
      InsertTime: '2017-11-20T23:02:40.055807',
      LastUpdate: '2017-11-20T23:02:40.055814',
      WhyThisAttribute: [
        {
          Hanglebangle: {
            ShortName: 'MOD11A1',
            VersionId: '006',
          },
        },
        {
          CollectionReference: {
            ShortName: 'MOD11A1',
            VersionId: '006',
          },
        },
      ],
    },
  };
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);
  t.is(cmrObject.Granule.WhyThisAttribute[1].CollectionReference.ShortName, 'a');
  t.is(cmrObject.Granule.WhyThisAttribute[1].CollectionReference.VersionId, 'b');
});

test('updateCmrFileCollections updates umm when missing', (t) => {
  const filename = 'ummg-meta.cmr.json';
  const cmrObject = {};
  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);
  t.is(cmrObject.CollectionReference.ShortName, 'a');
  t.is(cmrObject.CollectionReference.VersionId, 'b');
});

test('updateCmrFileCollections updates iso', async (t) => {
  const filename = 'tests/data/meta.cmr.iso.xml';
  const cmrObject = await promisify(xml2js.parseString)(fs.readFileSync(filename, 'utf-8'), xmlParseOptions);

  updateCmrFileCollections({ name: 'a', version: 'b' }, filename, cmrObject);

  t.is(get(cmrObject, 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.0.gmd:MD_Identifier.gmd:code.gco:CharacterString'), 'a');
  t.is(get(cmrObject, 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString'), 'b');
  // console.log(convertJSON2XML(cmrObject))
});
