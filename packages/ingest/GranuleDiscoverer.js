'use strict';

const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const groupBy = require('lodash.groupby');
const omit = require('lodash.omit');
const { buildProviderClient } = require('./providerClientUtils');
const { normalizeProviderPath } = require('./util');

class GranuleDiscoverer {
  /**
  * Discover class constructor
  *
  * @param {Object} event - the cumulus event object
  **/
  constructor(event) {
    this.buckets = event.config.buckets;
    this.collection = event.config.collection;
    this.ignoreFilesConfigForDiscovery = get(event.config,
      'ignoreFilesConfigForDiscovery', get(event.config.collection,
        'ignoreFilesConfigForDiscovery', false));

    this.providerClient = buildProviderClient({
      ...event.config.provider,
      path: normalizeProviderPath(this.collection.provider_path),
      useList: event.config.useList
    });
  }

  connected() {
    return get(this.providerClient, 'connected', false);
  }

  end() {
    return this.providerClient.end ? this.providerClient.end() : undefined;
  }

  /**
   * Receives a file object and adds granule-specific properties to it.
   *
   * @param {Object} file - the file object
   * @returns {Object} Updated file with granuleId added, and with bucket, file
   *    type, and url_path added, if the file has an associated configuration
   */
  setGranuleInfo(file) {
    const [, granuleId] = file.name.match(this.collection.granuleIdExtraction);
    const fileTypeConfig = this.fileTypeConfigForFile(file);

    // Return the file with granuleId added, and with bucket, url_path, and
    // type added if there is a config for the file.
    return Object.assign(
      cloneDeep(file),
      { granuleId },
      !fileTypeConfig ? {} : {
        bucket: this.buckets[fileTypeConfig.bucket].name,
        url_path: fileTypeConfig.url_path || this.collection.url_path || '',
        type: fileTypeConfig.type || ''
      }
    );
  }

  /**
   * Search for a file type config in the collection config
   *
   * @param {Object} file - a file object
   * @returns {Object|undefined} a file type config object or undefined if none
   *   was found
   * @private
   */
  fileTypeConfigForFile(file) {
    return this.collection.files.find((fileTypeConfig) =>
      file.name.match(fileTypeConfig.regex));
  }

  /**
   * Returns a possibly empty array of discovered granules.  Each granule will
   * contain a possibly empty array of files, influenced by the `boolean`
   * property `ignoreFilesConfigForDiscovery`.  By default, this property is
   * `false`, meaning that this collection's `files` configuration is _not_
   * ignored, and a granule's `files` array will contain _only_ files with names
   * that match one of the regular expressions in the collection's `files`
   * configuration.
   *
   * By setting `ignoreFilesConfigForDiscovery` to `true`, the collection's
   * `files` configuration is ignored, such that no files are filtered out based
   * on the regular expressions in the collection's `files` configuration.
   * Instead, _all_ files for a granule are included in the granule's `files`
   * array.
   *
   * The property may be set in the task configuration, in which case the
   * specified value overrides the value set on all collections.
   *
   * @returns {Array<Object>} an array of discovered granules
   */
  async discover() {
    const discoveredFiles = (await this.providerClient.list())
      // Make sure the file matches the granuleIdExtraction
      .filter((file) => file.name.match(this.collection.granuleIdExtraction))
      // Add additional granule-related properties to the file
      .map((file) => this.setGranuleInfo(file));

    // Group the files by granuleId
    const filesByGranuleId = groupBy(discoveredFiles, (file) => file.granuleId);
    const { dataType, version } = this.collection;

    // Build and return the granules
    return Object.entries(filesByGranuleId).map(([granuleId, files]) => ({
      granuleId,
      dataType,
      version,
      // Unless ignoring the files config, retain only files matching a config
      files: files
        .filter((file) =>
          this.ignoreFilesConfigForDiscovery
          || this.fileTypeConfigForFile(file))
        .map((file) => omit(file, 'granuleId'))
    }));
  }
}

module.exports = GranuleDiscoverer;
