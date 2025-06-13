'use strict';

const got = require('got');
const pWaitFor = require('p-wait-for');
const xml2js = require('xml2js');
const { s3 } = require('@cumulus/aws-client/services');
const { buildS3Uri } = require('@cumulus/aws-client/S3');
const { sleep } = require('@cumulus/common');
const log = require('@cumulus/common/log');
const { getSearchUrl } = require('@cumulus/cmr-client');

const THREE_SECONDS = 3000;
const ONE_MINUTE = 60000;

/**
 * Sample granule used to update fields and save as a .cmr.xml file
 */
const sampleEcho10Granule = {
  Granule: {
    GranuleUR: 'MYD13Q1.A2017297.h19v10.006.2017313221202',
    InsertTime: '2018-04-25T21:45:45.524043',
    LastUpdate: '2018-04-25T21:45:45.524053',
    Collection: {
      ShortName: 'MYD13Q1',
      VersionId: '006',
    },
    DataGranule:
    {
      SizeMBDataGranule: '10',
      ReprocessingPlanned: 'The Reprocessing Planned Statement Value',
      ReprocessingActual: 'The Reprocessing Actual Statement Value',
      ProducerGranuleId: 'SMAP_L3_SM_P_20150407_R13080_001.h5',
      DayNightFlag: 'UNSPECIFIED',
      ProductionDateTime: '2018-07-19T12:01:01Z',
      LocalVersionId: 'LocalVersionIdValue',
    },
    Temporal: {
      RangeDateTime: {
        BeginningDateTime: '2017-10-24T00:00:00Z',
        EndingDateTime: '2017-11-08T23:59:59Z',
      },
    },
    Spatial: {
      HorizontalSpatialDomain: {
        Geometry: {
          GPolygon: {
            Boundary: {
              Point: [
                {
                  PointLongitude: '10.598766856250499',
                  PointLatitude: '-20.004533998735798',
                },
                {
                  PointLongitude: '10.116488181247300',
                  PointLatitude: '-9.963464459448231',
                },
                {
                  PointLongitude: '20.318223437416400',
                  PointLatitude: '-9.958850980581371',
                },
                {
                  PointLongitude: '21.290997939442398',
                  PointLatitude: '-19.999772984245801',
                },
              ],
            },
          },
        },
      },
    },
    // TwoDCoordinateSystem: {
    //   StartCoordinate1: '19',
    //   StartCoordinate2: '10',
    //   TwoDCoordinateSystemName: 'MODIS Tile SIN'
    // },
    OnlineAccessURLs: [{
      OnlineAccessURL: {
        URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
        URLDescription: 'Download MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
      },
    }],
    Orderable: 'true',
    Visible: 'true',
    CloudCover: '13',
  },
};

const sampleUmmGranule = {
  SpatialExtent: {
    HorizontalSpatialDomain: {
      Geometry: {
        BoundingRectangles: [
          {
            WestBoundingCoordinate: -180,
            EastBoundingCoordinate: 180,
            NorthBoundingCoordinate: 90,
            SouthBoundingCoordinate: -90,
          },
        ],
      },
    },
  },
  ProviderDates: [
    {
      Date: '2018-12-19T17:30:31.424Z',
      Type: 'Insert',
    },
  ],
  DataGranule: {
    DayNightFlag: 'Unspecified',
    ProductionDateTime: '2016-01-09T11:40:45.032Z',
    ArchiveAndDistributionInformation: [
      {
        Name: 'Not provided',
        Size: 1.009857177734375,
        SizeUnit: 'NA',
      },
    ],
  },
  TemporalExtent: {
    RangeDateTime: {
      BeginningDateTime: '2016-01-09T11:40:45.032Z',
      EndingDateTime: '2016-01-09T11:41:12.027Z',
    },
  },
};

/**
 * Returns true if a granule concept search link returns 200,
 * false if a 404 is returned.
 *
 * @param {string} cmrLink
 *   CMR URL search path to granule concept search, e.g
 *   https://{cmr_url}/search/concepts/{concept_id}
 *
 * @returns {boolean} true if the concept exists in CMR, false if not
 */
async function conceptExists(cmrLink) {
  let response;

  try {
    response = await got.get(cmrLink);
  } catch (error) {
    if (error.response.statusCode !== 404) {
      throw error;
    }
    response = error.response;
  }

  if (response.statusCode !== 200) return false;

  return true;
}

/**
 * Checks for granule in CMR until it get the desired outcome or hits
 * the number of retries.
 *
 * @param {string} cmrLink - url for granule in CMR
 * @param {boolean} expectation - whether concept should exist (true) or not (false)
 * @returns {Promise<undefined>}
 * @throws {TimeoutError} - throws error when timeout is reached
 */
async function waitForConceptExistsOutcome(cmrLink, expectation) {
  try {
    await pWaitFor(
      async () => (await conceptExists(cmrLink)) === expectation,
      { interval: THREE_SECONDS, timeout: ONE_MINUTE }
    );

    // Wait for CMR to be consistent. See CUMULUS-962.
    await sleep(1000);
  } catch (error) {
    console.error('waitForConceptExistsOutcome() failed:', error);
    throw error;
  }
}

/**
 * Generate a granule xml string
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {Array<string>} additionalUrls - URLs to convert to online resources
 * @returns {Promise<Array<string>>} - Promise of the generated granule xml string
 * CMR xml files
 */
function generateCmrXml(granule, collection, additionalUrls) {
  const xmlObject = sampleEcho10Granule;
  const oldGranuleId = xmlObject.Granule.GranuleUR;
  xmlObject.Granule.GranuleUR = granule.granuleId;

  xmlObject.Granule.Collection = {
    ShortName: collection.name,
    VersionId: collection.version,
  };

  xmlObject.Granule.OnlineAccessURLs.forEach((url) => {
    // eslint-disable-next-line no-param-reassign
    url.OnlineAccessURL.URL = url.OnlineAccessURL.URL.replace(oldGranuleId, granule.granuleId);
  });

  if (additionalUrls) {
    xmlObject.Granule.OnlineAccessURLs = additionalUrls.map((url) => ({
      OnlineAccessURL: {
        URL: url,
        URLDescription: 'File to download',
      },
    }));
  }

  const xml = new xml2js.Builder().buildObject(xmlObject);
  return xml;
}

/**
 * Generate a granule xml and store to the given S3 bucket
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {string} bucket - bucket to save the xml file to
 * @param {Array<string>} additionalUrls - URLs to convert to online resources
 * @param {string} stagingDir - staging directory
 * @param {boolean} matchFilesWithProducerGranuleId - When set to true, use the 'producerGranuleId'
 * instead default behavior of using 'granuleId' when generating filenames.
 * @returns {Promise<Array<string>>} - Promise of a list of granule files including the created
 * CMR xml files
 */
async function generateAndStoreCmrXml(granule, collection, bucket, additionalUrls, stagingDir = 'file-staging',
  matchFilesWithProducerGranuleId = false) {
  const xml = generateCmrXml(granule, collection, additionalUrls);
  const granuleFiles = granule.files.map((f) => `s3://${f.bucket}/${f.key}`);

  const fileNameBase = matchFilesWithProducerGranuleId
    ? granule.producerGranuleId
    : granule.granuleId;
  const fileKey = `${stagingDir}/${fileNameBase}.cmr.xml`;

  const params = {
    Bucket: bucket,
    Key: fileKey,
    Body: xml,
    ContentType: 'application/xml',
    Tagging: `granuleId=${granule.granuleId}`,
  };

  await s3().putObject(params);

  granuleFiles.push(`s3://${bucket}/${fileKey}`);
  log.info(`s3://${bucket}/${fileKey}`);
  log.info(granuleFiles);
  return granuleFiles;
}

/**
 * Transforms a CMR metadata format to a version string or returns an empty string.
 *
 * @param {string} typeStr
 * @returns {string} the decoded version or empty string if a version can't be created.
 */
function metadataFormatToVersion(typeStr) {
  try {
    return typeStr.match(/umm_json_v(.*)/)[1].replace(/_/g, '.');
  } catch (error) {
    return '';
  }
}

/**
 * tester to determine if the input cmrMetadataFormat is a UMM JSON file.
 * @param {string} cmrMetadataFormat
 * @returns {boolean} true if the cmrMetadataFormat matches umm_json_v
 */
function isUMMGMetadataFormat(cmrMetadataFormat) {
  return cmrMetadataFormat && cmrMetadataFormat.match(/umm_json_v/);
}

async function getCmrMetadataECHO10(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    console.log(`Error fetching CMR metadata, status code: ${response.statusCode}, response: ${JSON.stringify(response.body)}`);
    return null;
  }

  return JSON.parse(response.body);
}
/**
 * Get the online resource links from the CMR objects for ECH010
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 * @returns {Array<Object>} Array of link objects in the format
 * { inherited: true,
    rel: 'http://esipfed.org/ns/fedsearch/1.1/metadata#',
    hreflang: 'en-US',
    href: 'https://opendap.cr.usgs.gov/opendap/hyrax/MYD13Q1.006/contents.html' }
 */
async function getOnlineResourcesECHO10(cmrLink) {
  const body = await getCmrMetadataECHO10(cmrLink);
  return body.links;
}

async function getCmrMetadataUMMG(cmrLink) {
  const response = await got.get(cmrLink);
  if (response.statusCode !== 200) {
    console.log(`Error fetching CMR metadata, status code: ${response.statusCode}, response: ${JSON.stringify(response.body)}`);
    return null;
  }
  return JSON.parse(response.body);
}

/**
 * Get the online resource links from the CMR objects for UMM-G
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 * @returns {Array<Object>} Array of link objects in the format
 * { URL: "https://example.com/cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A0794505._4kqJd.006.9457902462263.hdf",
    Description: "Download MOD09GQ.A0794505._4kqJd.006.9457902462263.hdf",
    Type: "GET DATA" }
 */
async function getOnlineResourcesUMMG(cmrLink) {
  const body = await getCmrMetadataUMMG(cmrLink);
  const links = body.items.map((item) => item.umm.RelatedUrls);

  // Links is a list of a list, so flatten to be one list
  return [].concat(...links);
}

/**
 * Fetches full granule object from CMR based on file type (ECHO10, UMM-G)
 *
 * @param {Object} granule
 * @param {string} granule.cmrMetadataFormat - the cmr file type (e.g. echo10, umm-g)
 * @param {Object} granule.cmrConceptId - the CMR granule concept ID
 * @param {Object} granule.cmrLink - the metadata's granuleId
 *
 * @returns {Promise<Array<Object>>} - Promise returning array of links
 */
async function getCmrMetadata({ cmrMetadataFormat, cmrConceptId, cmrLink }) {
  console.log('Running getCmrMetadata');
  console.log(cmrLink);
  console.log(`${getSearchUrl()}granules.umm_json?concept_id=${cmrConceptId}`);
  if (cmrMetadataFormat === 'echo10') {
    return await getCmrMetadataECHO10(cmrLink.replace(/(.echo10)$/, '.json'));
  }
  if (isUMMGMetadataFormat(cmrMetadataFormat)) {
    return await getCmrMetadataUMMG(`${getSearchUrl()}granules.umm_json?concept_id=${cmrConceptId}`);
  }
  throw new Error(`Invalid cmrMetadataFormat passed to getOnlineResources: ${cmrMetadataFormat}`);
}

/**
 * Fetches online resources from CMR based on file type (ECHO10, UMM-G)
 *
 * @param {Object} granule
 * @param {string} granule.cmrMetadataFormat - the cmr file type (e.g. echo10, umm-g)
 * @param {Object} granule.cmrConceptId - the CMR granule concept ID
 * @param {Object} granule.cmrLink - the metadata's granuleId
 *
 * @returns {Promise<Array<Object>>} - Promise returning array of links
 */
async function getOnlineResources({ cmrMetadataFormat, cmrConceptId, cmrLink }) {
  if (cmrMetadataFormat === 'echo10') {
    console.log(cmrLink);
    return await getOnlineResourcesECHO10(cmrLink.replace(/(.echo10)$/, '.json'));
  }
  if (isUMMGMetadataFormat(cmrMetadataFormat)) {
    console.log(`${getSearchUrl()}granules.umm_json?concept_id=${cmrConceptId}`);
    return await getOnlineResourcesUMMG(`${getSearchUrl()}granules.umm_json?concept_id=${cmrConceptId}`);
  }
  throw new Error(`Invalid cmrMetadataFormat passed to getOnlineResources: ${cmrMetadataFormat}}`);
}

/**
 * Generate granule UMM-G JSON file based on the sample UMM-G and store
 * it to S3 in the file staging area
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {string} bucket - bucket to save the xml file to
 * @param {Array<string>} additionalUrls - URLs to convert to related urls
 * @param {string} cmrMetadataFormat - CMR UMM-G version string <umm_json_v[x.y]>
 * @param {string} stagingDir - staging directory
 * @param {boolean} matchFilesWithProducerGranuleId - When set to true, use the 'producerGranuleId'
 * instead default behavior of using 'granuleId' when generating filenames.
 * @returns {Promise<Array<string>>} - Promise of a list of granule files including the created
 * CMR files
 */
async function generateAndStoreCmrUmmJson(
  granule,
  collection,
  bucket,
  additionalUrls,
  cmrMetadataFormat,
  stagingDir = 'file-staging',
  matchFilesWithProducerGranuleId = false
) {
  const versionString = metadataFormatToVersion(cmrMetadataFormat);
  const jsonObject = sampleUmmGranule;
  jsonObject.GranuleUR = granule.granuleId;

  jsonObject.CollectionReference = {
    ShortName: collection.name,
    Version: collection.version,
  };

  if (additionalUrls) {
    jsonObject.RelatedUrls = additionalUrls.map((url) => ({
      URL: url,
      Type: 'GET DATA',
    }));
  }

  const defaultVersion = 1.4;
  // convert version string like 1.6.2 to 1.62 for comparision
  if (Number(versionString.replace('.', '_').replace(/\./g, '').replace('_', '.')) > defaultVersion) {
    jsonObject.MetadataSpecification = {
      URL: `https://cdn.earthdata.nasa.gov/umm/granule/v${versionString}`,
      Name: 'UMM-G',
      Version: versionString,
    };
  }

  const fileNameBase = matchFilesWithProducerGranuleId
    ? granule.producerGranuleId
    : granule.granuleId;
  const fileKey = `${stagingDir}/${fileNameBase}.cmr.json`;

  const params = {
    Bucket: bucket,
    Key: fileKey,
    Body: JSON.stringify(jsonObject),
    ContentType: 'application/json',
    Tagging: `granuleId=${granule.granuleId}`,
  };

  await s3().putObject(params);

  const granuleFiles = granule.files.map((f) => buildS3Uri(f.bucket, f.key));
  granuleFiles.push(`s3://${bucket}/${fileKey}`);
  log.info(`s3://${bucket}/${fileKey}`);
  log.info(granuleFiles);
  return granuleFiles;
}

/**
 * Generate .cmr.xml files for the granules and store them in S3 to the
 * given S3 location
 *
 * @param {Array<Object>} granules - list of granules in the format of the sync-granules
 *                                   output
 * @param {Object} collection - collection object that includes name and version
 * @param {string} bucket - location to save the xmls to
 * @param {string} cmrMetadataFormat - CMR file type to generate. Options are echo10, umm_json_v1_4,
 *                               umm_json_v1_5, (and likely umm_json_v1_<x>). The default is echo10
 * @param {Array<string>} additionalUrls - URLs to convert to online resources or related urls
 * @returns {Array<string>} list of S3 locations for CMR xml files
 */
async function generateCmrFilesForGranules({
  granules,
  collection,
  bucket,
  cmrMetadataFormat,
  additionalUrls,
  stagingDir,
  matchFilesWithProducerGranuleId = false,
}) {
  let files;

  log.info(`Generating fake CMR file with type ${cmrMetadataFormat}`);

  if (isUMMGMetadataFormat(cmrMetadataFormat)) {
    files = await Promise.all(
      granules.map((g) =>
        generateAndStoreCmrUmmJson(
          g,
          collection,
          bucket,
          additionalUrls,
          cmrMetadataFormat,
          stagingDir,
          matchFilesWithProducerGranuleId
        ))
    );
  } else {
    files = await Promise.all(
      granules.map((g) =>
        generateAndStoreCmrXml(
          g,
          collection,
          bucket,
          additionalUrls,
          stagingDir,
          matchFilesWithProducerGranuleId
        ))
    );
  }

  return [].concat(...files);
}

module.exports = {
  conceptExists,
  getOnlineResources,
  getCmrMetadata,
  generateCmrFilesForGranules,
  generateCmrXml,
  waitForConceptExistsOutcome,
};
