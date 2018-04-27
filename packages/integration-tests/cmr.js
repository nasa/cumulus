'use strict';

/* eslint-disable no-param-reassign */

const got = require('got');

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

module.exports = {
  conceptExists,
  getOnlineResources
};
