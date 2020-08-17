'use strict';

const moment = require('moment');
const { isNil } = require('@cumulus/common/util');
const Granule = require('../models/granules');
const { deconstructCollectionId } = require('./utils');
const GranuleFilesCache = require('./GranuleFilesCache');
const FileUtils = require('./FileUtils');

/**
 * This class takes an S3 Server Log line and parses it for EMS Distribution Logs
 *
 * The format of S3 Server Log lines is documented here:
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/dev/LogFormat.html
 *
 * Example S3 Server Log line:
 *
 * fe3f16719bb293e218f6e5fea86e345b0a696560d784177395715b24041da90e my-dist-bucket
 * [01/June/1981:01:02:13 +0000] 192.0.2.3 arn:aws:iam::000000000000:user/joe
 * 1CB21F5399FF76C5 REST.GET.OBJECT my-dist-bucket/pdrs/
 * MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR
 * "GET /my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR
 * ?A-userid=amalkin HTTP/1.1"
 * 200 - 807 100 22 22 "-" "curl/7.59.0" -
 * +AzZ/OMoP7AqT6ZHEOdLoFbmTn+TKKh0UBxKQkpJthfh2f4GE4GwT3VQHxuFhC42O1gCWWYFsiw= SigV4
 * ECDHE-RSA-AES128-GCM-SHA256 QueryString my-dist-bucket.s3.amazonaws.com TLSv1.2
 */
class DistributionEvent {
  /**
   * Test if a given S3 Server Access Log line contains a distribution event
   *
   * @param {string} s3ServerLogLine - An S3 Server Access Log line
   * @returns {boolean} `true` if the line contains a distribution event,
   *   `false` otherwise
   */
  static isDistributionEvent(s3ServerLogLine) {
    return s3ServerLogLine.includes('REST.GET.OBJECT')
      && s3ServerLogLine.includes('A-userid');
  }

  /**
   * Constructor for DistributionEvent objects
   *
   * @param {string} s3ServerLogLine - an S3 Server Log line
   */
  constructor(s3ServerLogLine) {
    if (!DistributionEvent.isDistributionEvent(s3ServerLogLine)) {
      throw new Error(`Invalid distribution event: ${s3ServerLogLine}`);
    }

    this.rawLine = s3ServerLogLine;
  }

  /**
   * Get the bucket that the object was fetched from
   *
   * @returns {string} a bucket name
   */
  get bucket() {
    return this.rawLine.split(' ')[1];
  }

  /**
   * Get the number of bytes sent to the client
   *
   * @returns {number} bytes sent
   */
  get bytesSent() {
    return Number.parseInt(this.rawLine.split('"')[2].trim().split(' ')[2], 10);
  }

  /**
   * Get the key of the object that was fetched
   *
   * @returns {string} an S3 key
   */
  get key() {
    return this.rawLine.split('REST.GET.OBJECT')[1].trim().split(' ')[0];
  }

  /**
   * Get the client's IP address
   *
   * @returns {string} an IP address
   */
  get remoteIP() {
    return this.rawLine.includes('A-sourceip')
      ? this.getRequestQueryParamValue('A-sourceip')
      : this.rawLine.split(']')[1].trim().split(' ')[0];
  }

  /**
   * Get the size of the object
   *
   * @returns {number} size in bytes
   */
  get objectSize() {
    return Number.parseInt(this.rawLine.split('"')[2].trim().split(' ')[3], 10);
  }

  /**
   * Get the time of the event
   *
   * @returns {Moment} the time of the event
   */
  get time() {
    return moment(
      this.rawLine.split('[')[1].split(']')[0],
      'DD/MMM/YYYY:hh:mm:ss ZZ'
    ).utc();
  }

  /**
   * Get the success or failure status of the event
   *
   * @returns {string} "S" or "F"
   */
  get transferStatus() {
    return this.bytesSent === this.objectSize ? 'S' : 'F';
  }

  /**
   * Get the Earthdata Login username that fetched the S3 object
   *
   * @returns {string} a username
   */
  get username() {
    const username = this.getRequestQueryParamValue('A-userid');
    return username && username !== 'None' ? username : '-';
  }

  /**
   * Parse and return request URL in distribution event.
   *
   * Sets `this.requestUrlObject` to a [URL](https://nodejs.org/api/url.html) object.
   *
   * @returns {URL} - parsed request URL
   */
  getRequestUrlObject() {
    if (!this.requestUrlObject) {
      const requestUri = this.rawLine.split('"')[1].split(' ')[1];
      this.requestUrlObject = (new URL(requestUri, 'http://localhost'));
    }
    return this.requestUrlObject;
  }

  /**
   * Get a query parameter value from the request URI in the distribution event.
   *
   * @param {string} queryParam - name of query parameter value to get
   * @returns {string} - value of query parameter
   */
  getRequestQueryParamValue(queryParam) {
    const requestUrl = this.getRequestUrlObject();
    return requestUrl.searchParams.get(queryParam);
  }

  /**
   * get file type
   *
   * @param {string} bucket - s3 bucket of the file
   * @param {string} key - s3 key of the file
   * @param {Object} granule - granule object of the file
   * @returns {string} EMS file type
   */
  getFileType(bucket, key, granule) {
    // EMS dpFiletype field possible values
    const emsTypes = ['PH', 'QA', 'METADATA', 'BROWSE', 'SCIENCE', 'OTHER', 'DOC'];

    // convert Cumulus granule file.type (CNM file type) to EMS file type
    const fileTypes = granule.files
      .filter((file) => {
        const fileBucket = FileUtils.getBucket(file);
        const fileKey = FileUtils.getKey(file);

        return fileBucket === bucket && fileKey === key;
      })
      .map((file) => {
        let fileType = file.type || 'OTHER';
        fileType = (fileType === 'data') ? 'SCIENCE' : fileType.toUpperCase();
        return (emsTypes.includes(fileType)) ? fileType : 'OTHER';
      });
    return fileTypes[0] || 'OTHER';
  }

  /**
   * Get the product information (collectionId, name, version, granuleId and file type) of the file
   *
   * @returns {Object} product object
   */
  async getProductInfo() {
    if (isNil(this.productInfo)) {
      const granuleId = await GranuleFilesCache.getGranuleId(this.bucket, this.key);

      if (granuleId) {
        const granule = await (new Granule()).getRecord({ granuleId });

        this.productInfo = {
          collectionId: granule.collectionId,
          ...deconstructCollectionId(granule.collectionId),
          granuleId: granule.granuleId,
          fileType: this.getFileType(this.bucket, this.key, granule),
        };
      } else {
        this.productInfo = {};
      }
    }

    return this.productInfo;
  }

  /**
   * Get the product name, version, granuleId and file type
   *
   * @returns {Promise<Array<string>>} product name, version, granuleId and file type
   */
  get product() {
    return this.getProductInfo()
      .then((productInfo) => [
        productInfo.name,
        productInfo.version,
        productInfo.granuleId,
        productInfo.fileType,
      ]);
  }

  /**
   * Return the event in an EMS-parsable format
   *
   * @returns {string} an EMS distribution log entry
   */
  async toString() {
    const upperCasedMonth = this.time.format('MMM').toUpperCase();

    return [
      this.time.format(`DD-[${upperCasedMonth}]-YY hh:mm:ss A`),
      this.username,
      this.remoteIP,
      `s3://${this.bucket}/${this.key}`,
      this.bytesSent,
      this.transferStatus,
    ]
      .concat(await this.product) // product name, version, granuleId and file type
      .concat(['HTTPS']) // protocol
      .join('|&|');
  }
}

module.exports = DistributionEvent;
