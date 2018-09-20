'use strict';

const got = require('got');
const pWaitFor = require('p-wait-for');
const xml2js = require('xml2js');
const { s3 } = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');

/**
 * Sample granule used to update fields and save as a .cmr.xml file
 */
const sampleGranule = {
  Granule: {
    GranuleUR: 'MYD13Q1.A2017297.h19v10.006.2017313221202',
    InsertTime: '2018-04-25T21:45:45.524043',
    LastUpdate: '2018-04-25T21:45:45.524053',
    Collection: {
      ShortName: 'MYD13Q1',
      VersionId: '006'
    },
    Temporal: {
      RangeDateTime: {
        BeginningDateTime: '2017-10-24T00:00:00Z',
        EndingDateTime: '2017-11-08T23:59:59Z'
      }
    },
    Spatial: {
      HorizontalSpatialDomain: {
        Geometry: {
          GPolygon: {
            Boundary: {
              Point: [
                {
                  PointLongitude: '10.598766856250499',
                  PointLatitude: '-20.004533998735798'
                },
                {
                  PointLongitude: '10.116488181247300',
                  PointLatitude: '-9.963464459448231'
                },
                {
                  PointLongitude: '20.318223437416400',
                  PointLatitude: '-9.958850980581371'
                },
                {
                  PointLongitude: '21.290997939442398',
                  PointLatitude: '-19.999772984245801'
                }
              ]
            }
          }
        }
      }
    },
    TwoDCoordinateSystem: {
      StartCoordinate1: '19',
      StartCoordinate2: '10',
      TwoDCoordinateSystemName: 'MODIS Tile SIN'
    },
    OnlineAccessURLs: {
      OnlineAccessURL: {
        URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
        URLDescription: 'File to download'
      }
    },
    Orderable: 'true',
    Visible: 'true',
    CloudCover: '13'
  }
};

/**
 * Returns true if the concept exists - if the cmrLink
 * returns a 200 and there are entries
 *
 * @param {string} cmrLink - CMR URL path to concept,
 * i.e. what is returned from post to cmr task
 * @returns {boolean} true if the concept exists in CMR, false if not
 */
async function conceptExists(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return false;
  }

  const body = JSON.parse(response.body);

  return body.feed.entry.length > 0;
}

/**
 * Checks for granule in CMR until it get the desired outcome or hits
 * the number of retries.
 *
 * @param {string} cmrLink - url for granule in CMR
 * @param {boolean} expectation - whether concept should exist (true) or not (false)
 * @param {string} retries - number of remaining tries
 * @param {number} interval - time (in ms) to wait between tries
 * @returns {undefined} - undefined
 */
async function waitForConceptExistsOrNot(cmrLink, expectation, retries = 3, interval = 2000) {
  await pWaitFor(
    async () => (await conceptExists(cmrLink)) === expectation,
    {
      interval,
      timeout: interval * retries
    }
  );
}

/**
 * Get the online resource links from the CMR objects
 *
 * @param {string} cmrLink - CMR URL path to concept,
 * i.e. what is returned from post to cmr task
 * @returns {Array<Object>} Array of link objects in the format
 * { inherited: true,
    rel: 'http://esipfed.org/ns/fedsearch/1.1/metadata#',
    hreflang: 'en-US',
    href: 'https://opendap.cr.usgs.gov/opendap/hyrax/MYD13Q1.006/contents.html' }
 */
async function getOnlineResources(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return null;
  }

  const body = JSON.parse(response.body);

  const links = body.feed.entry.map((e) => e.links);

  // Links is a list of a list, so flatten to be one list
  return [].concat(...links);
}

/**
 * Generate a granule xml and store to the given S3 bucket
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {string} bucket - bucket to save the xml file to
 * @returns {Array<string>} - List of granule files including the created
 * CMR xml files
 */
async function generateAndStoreCmrXml(granule, collection, bucket) {
  const xmlObject = sampleGranule;
  xmlObject.Granule.GranuleUR = granule.granuleId;

  xmlObject.Granule.Collection = {
    ShortName: collection.name,
    VersionId: collection.version
  };

  const granuleFiles = granule.files.map((f) => f.filename);

  xmlObject.Granule.OnlineAccessURLs.OnlineAccessURL = granuleFiles.map((f) => ({
    URL: f,
    URLDescription: 'File to download'
  }));

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(xmlObject);

  const stagingDir = granule.files[0].fileStagingDir;

  const filename = `${stagingDir}/${granule.granuleId}.cmr.xml`;

  const params = {
    Bucket: bucket,
    Key: filename,
    Body: xml
  };

  await s3().putObject(params).promise();

  granuleFiles.push(`s3://${bucket}/${filename}`);
  log.info(`s3://${bucket}/${filename}`);
  log.info(granuleFiles);
  return granuleFiles;
}

/**
 * Generate .cmr.xml files for the granules and store them in S3 to the
 * given S3 location
 *
 * @param {Array<Object>} granules - list of granules in the format of the sync-granules
 * output
 * @param {Object} collection - collection object that includes name and version
 * @param {string} bucket - location to save the xmls to
 * @returns {Array<string>} list of S3 locations for CMR xml files
 */
async function generateCmrFilesForGranules(granules, collection, bucket) {
  const files = await Promise.all(granules.map((g) =>
    generateAndStoreCmrXml(g, collection, bucket)));

  return [].concat(...files);
}

module.exports = {
  conceptExists,
  getOnlineResources,
  generateCmrFilesForGranules,
  waitForConceptExistsOrNot
};
