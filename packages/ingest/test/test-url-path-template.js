'use strict';

const test = require('ava');
const fs = require('fs');
const path = require('path');
const { parseString } = require('xml2js');
const { xmlParseOptions } = require('@cumulus/cmrjs/utils');
const { urlPathTemplate } = require('../url-path-template');

const modisXmlFile = path.join(
  __dirname,
  '..',
  'node_modules/@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml'
);
const measuresXmlFile = path.join(
  __dirname,
  '..',
  'node_modules/@cumulus/test-data/granules/antarctica_ice_velocity_450m.nc.cmr.xml'
);

/**
* read and parse cmr metadata file into json object
*
* @param {string} xmlFile - file name of the cmr echo10 xml metadata
* @returns {Promise<Object>} metadata object
*/
function getTestMetadata(xmlFile) {
  const xmlString = fs.readFileSync(xmlFile, 'utf8');
  return new Promise((resolve, reject) => {
    parseString(xmlString, xmlParseOptions, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });
}

test('test basic usage', (t) => {
  const urlPath = '/{file.bucket}/{file.name}';
  const context = {
    file: {
      bucket: 'example',
      name: 'file.hdf',
    },
  };

  const result = urlPathTemplate(urlPath, context);
  t.is(result, '/example/file.hdf');
});

test('url path has metadata fields', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const urlPath = '{cmrMetadata.Granule.Collection.ShortName}.{cmrMetadata.Granule.Collection.VersionId}';
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, 'MOD09GQ.006');
});

test('url path has operations on metadata date components', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  // build a long url path
  const yearPart = '{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  const monthPart = '{extractMonth(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  const datePart = '{extractDate(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  const hourPart = '{extractHour(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  const urlPath = yearPart.concat(monthPart, datePart, hourPart);
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, '2016/12/23/13/');
});

test('url path has substring operation', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const urlPath = '{substring(cmrMetadata.Granule.PGEVersionClass.PGEVersion, 0, 3)}';
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, '6.0');
});

test('url path has dateFormat operation', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const urlPath = '{dateFormat(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime, YYYY-MM-DD[T]HH[:]mm[:]ss)}';
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, '2016-12-23T13:45:00');
});

test('urlPathTemplate has metadata field which has multiple values', async (t) => {
  const metadataObject = await getTestMetadata(measuresXmlFile);
  const urlPath = '{cmrMetadata.Granule.Platforms.Platform[0].ShortName}';
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, 'ALOS');
});

test.only('urlPathTemplate supports extractPath operation', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const urlPath = '{notNull(granule.producerGranuleId, granule.granuleId)}';
  const result = urlPathTemplate(urlPath, { cmrMetadata: metadataObject });
  t.is(result, '2016-12-23T13:45:00');
});

test('urlPathTemplate supports notNull operation', (t) => {
  const context = {
    file: {
      source: '/data/GPM_L3/GPM_3IMERGHH.06/2021/001/abc.efg.HDF.xml',
    },
  };
  const urlPath = '{extractPath(file.source)}';
  const result = urlPathTemplate(urlPath, context);
  t.is(result, '/data/GPM_L3/GPM_3IMERGHH.06/2021/001');
});

test('urlPathTemplate supports operation with constant argument', (t) => {
  const context = {
    foo: 'boo',
  };
  const urlPath = '{extractPath(/data/GPM_L3/GPM_3IMERGHH.06/2021/001/abc.efg.HDF.xml)}';
  const result = urlPathTemplate(urlPath, context);
  t.is(result, '/data/GPM_L3/GPM_3IMERGHH.06/2021/001');
});

test('urlPathTemplate supports nested operations', (t) => {
  const context = {
    file: {
      source: '/data/GPM_L3/GPM_3IMERGHH.06/2021/001/abc.efg.HDF.xml',
    },
  };
  const urlPath = '{extractPath({substring(file.source, 6)})}';
  const result = urlPathTemplate(urlPath, context);
  t.is(result, 'GPM_L3/GPM_3IMERGHH.06/2021/001');
});

test('urlPathTemplate supports multiple and nested operations', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const context = {
    file: {
      source: '/data/GPM_L3/GPM_3IMERGHH.06/2021/001/abc.efg.HDF.xml',
    },
    cmrMetadata: metadataObject,
  };
  const urlPath = '/destinationdata/{cmrMetadata.Granule.Collection.ShortName}/{substring({extractPath(file.source)}, 6)}';
  const result = urlPathTemplate(urlPath, context);
  t.is(result, '/destinationdata/MOD09GQ/GPM_L3/GPM_3IMERGHH.06/2021/001');
});

test('urlPathTemplate throws exception when operation is not supported', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const context = { cmrMetadata: metadataObject };
  const urlPath = '{unsupportedOperation(cmrMetadata.Granule.Collection.ShortName)}';
  t.throws(
    () => urlPathTemplate(urlPath, context),
    { message: /Error: Could not support operation unsupportedOperation/ }
  );
});

test('urlPathTemplate throws exception when object path does not exist', async (t) => {
  const metadataObject = await getTestMetadata(modisXmlFile);
  const context = { cmrMetadata: metadataObject };
  const urlPath = '{substring(cmrMetadata.nonexistentfield.Collection.ShortName, 1, 3)}';
  t.throws(
    () => urlPathTemplate(urlPath, context),
    { message: /Could not resolve path cmrMetadata.nonexistentfield.Collection.ShortName/ }
  );
});
