const aws = require('./aws');
const encodeurl = require('encodeurl');
const errors = require('./errors');
const log = require('./log');
const urljoin = require('url-join');
const xml2js = require('xml2js');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

/**
 * Copy ggranule file from one s3 bucket & keypath to another
 *
 * @param {Object} source - source
 * @param {string} source.Bucket - source bucket
 * @param {string} source.Key - source key
 * @param {Object} target - target
 * @param {string} target.Bucket - target bucket
 * @param {string} target.Key - target key
 * @param {Object} options - optional object with properties as defined by AWS API:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property
 * @returns {Promise} returns a promise that is resolved when the file is copied
 **/
exports.copyGranuleFile = (source, target, options) => {
  const CopySource = encodeurl(urljoin(source.Bucket, source.Key));

  const params = Object.assign({
    CopySource,
    Bucket: target.Bucket,
    Key: target.Key
  }, (options || {}));

  return aws.s3().copyObject(params).promise()
    .catch((err) => {
      log.error(`failed to copy s3://${CopySource} to s3://${target.Bucket}/${target.Key}: ${err.message}`); // eslint-disable-line max-len
      throw err;
    });
};

/**
 * Move granule file from one s3 bucket & keypath to another
 *
 * @param {Object} source - source
 * @param {string} source.Bucket - source bucket
 * @param {string} source.Key - source key
 * @param {Object} target - target
 * @param {string} target.Bucket - target bucket
 * @param {string} target.Key - target key
 * @param {Object} options - optional object with properties as defined by AWS API:
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-prop
 * @returns {Promise} returns a promise that is resolved when the file is moved
 **/
exports.moveGranuleFile = async (source, target, options) => {
  await exports.copyGranuleFile(source, target, options);
  return aws.s3().deleteObject(source).promise();
};

/**
 * Gets metadata for a cmr xml file from s3
 *
 * @param {string} xmlFilePath - S3 URI to the xml metadata document
 * @returns {string} returns stringified xml document downloaded from S3
 */
exports.getMetadata = async (xmlFilePath) => {
  if (!xmlFilePath) {
    throw new errors.XmlMetaFileNotFound('XML Metadata file not provided');
  }

  // GET the metadata text
  // Currently only supports files that are stored on S3
  const parts = xmlFilePath.match(/^s3:\/\/(.+?)\/(.+)$/);
  const obj = await aws.getS3Object(parts[1], parts[2]);
  return obj.Body.toString();
};

/**
 * Parse an xml string
 *
 * @param {string} xml - xml to parse
 * @returns {Promise<Object>} promise resolves to object version of the xml
 */
exports.parseXmlString = async (xml) =>
  new Promise((resolve, reject) => {
    xml2js.parseString(xml, xmlParseOptions, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });

/**
 * Post s3 object, delete old options if they exist
 *
 * @param {Object} destination - destination
 * @param {string} destination.bucket - destination bucket
 * @param {string} destination.key - key
 * @param {string} destination.body - body to upload
 * @param {Object} options - s3 upload options
 * @returns {undefined} undefined
 */
exports.postS3Object = async (destination, options) => {
  await aws.promiseS3Upload(
    { Bucket: destination.bucket, Key: destination.key, Body: destination.body }
  );
  if (options) {
    const s3 = aws.s3();
    await s3.deleteObject(options).promise();
  }
};

/**
 * construct a list of online access urls
 *
 * @param {Array<Object>} files - array of file objects
 * @param {string} distEndpoint - distribution endpoint from config
 * @returns {Array<{URL: string, URLDescription: string}>} returns the
 *   list of online access url objects
 */
exports.constructOnlineAccessUrls = async (files, distEndpoint) => {
  const urls = [];

  const bucketString = await aws.s3().getObject({
    Bucket: process.env.bucket,
    Key: `${process.env.stackName}/workflows/buckets.json`
  }).promise();
  const bucketsObject = JSON.parse(bucketString.Body);

  // URLs are for public and protected files
  const bucketKeys = Object.keys(bucketsObject);
  files.forEach((file) => {
    const urlObj = {};
    const bucketkey = bucketKeys.find((bucketKey) =>
      file.bucket === bucketsObject[bucketKey].name);
    if (bucketsObject[bucketkey].type === 'protected') {
      const extension = urljoin(bucketsObject[bucketkey].name, `${file.filepath}`);
      urlObj.URL = urljoin(distEndpoint, extension);
      urlObj.URLDescription = 'File to download';
      urls.push(urlObj);
    }
    else if (bucketsObject[bucketkey].type === 'public') {
      urlObj.URL = `https://${bucketsObject[bucketkey].name}.s3.amazonaws.com/${file.filepath}`;
      urlObj.URLDescription = 'File to download';
      urls.push(urlObj);
    }
  });
  return urls;
};

/**
 * Updates cmr xml file with updated file urls
 *
 * @param {string} granuleId - granuleId
 * @param {Object} cmrFile - cmr xml file to be updated
 * @param {Object[]} files - array of file objects
 * @param {string} distEndpoint - distribution endpoint from config
 * @param {boolean} published - indicate if publish is needed
 * @returns {Promise} returns promise to upload updated cmr file
 */
exports.updateMetadata = async (granuleId, cmrFile, files, distEndpoint, published) => {
  log.debug(`granules.updateMetadata granuleId ${granuleId}, xml file ${cmrFile.filename}`);

  const urls = await exports.constructOnlineAccessUrls(files, distEndpoint);

  // add/replace the OnlineAccessUrls
  const metadata = await exports.getMetadata(cmrFile.filename);
  const metadataObject = await exports.parseXmlString(metadata);
  const metadataGranule = metadataObject.Granule;
  const updatedGranule = {};
  Object.keys(metadataGranule).forEach((key) => {
    if (key === 'OnlineResources' || key === 'Orderable') {
      updatedGranule.OnlineAccessURLs = {};
    }
    updatedGranule[key] = metadataGranule[key];
  });
  updatedGranule.OnlineAccessURLs.OnlineAccessURL = urls;
  metadataObject.Granule = updatedGranule;
  const builder = new xml2js.Builder();
  const xml = builder.buildObject(metadataObject);

  // post meta file to CMR
  const creds = {
    provider: process.env.cmr_provider,
    clientId: process.env.cmr_client_id,
    username: process.env.cmr_username,
    password: process.env.cmr_password
  };

  const cmrFileObject = {
    filename: cmrFile.filename,
    metadata: xml,
    granuleId: granuleId
  };
  if (published) await publish(cmrFileObject, creds, process.env.bucket, process.env.stackName);
  return exports.postS3Object({ bucket: cmrFile.bucket, key: cmrFile.filepath, body: xml });
};

/**
 * Move granule files from one s3 location to another
 *
 * @param {string} granuleId - granuleId
 * @param {Array<Object>} sourceFiles - array of file objects, they are updated with dstination
 * location after the files are moved
 * @param {string} sourceFiles.name - file name
 * @param {string} sourceFiles.bucket - current bucket of file
 * @param {string} sourceFiles.filepath - current s3 key of file
 * @param {Object[]} destinations - array of objects defining the destination of granule files
 * @param {string} destinations.regex - regex for matching filepath of file to new destination
 * @param {string} destinations.bucket - aws bucket of the destination
 * @param {string} destinations.filepath - file path/directory on the bucket for the destination
 * @param {string} distEndpoint - distribution endpoint from config
 * @param {boolean} published - indicates if published is needed
 * @returns {Promise<Object>} returns promise from publishing cmr file
 **/
exports.moveGranuleFiles = async (
  granuleId,
  sourceFiles,
  destinations,
  distEndpoint,
  published
) => {
  const moveFileRequests = sourceFiles.map((file) => {
    const destination = destinations.find((dest) => file.name.match(dest.regex));
    const parsed = aws.parseS3Uri(file.filename);
    // if there's no match, wes skip the file
    if (destination) {
      const source = {
        Bucket: parsed.Bucket,
        Key: parsed.Key
      };

      const target = {
        Bucket: destination.bucket,
        Key: urljoin(destination.filepath, file.name)
      };

      log.debug('moveGranuleFiles', source, target);
      return exports.moveGranuleFile(source, target)
        .then(() => { /* eslint-disable no-param-reassign */
          // update the granule file location in source file
          file.bucket = target.Bucket;
          file.filepath = target.Key;
          file.filename = aws.buildS3Uri(file.bucket, file.filepath);
        });
    }
    // else set filepath as well so it won't be null
    file.filepath = parsed.Key;
    return Promise.resolve();
  });

  await Promise.all(moveFileRequests);

  // update cmr metadata with new file urls
  const xmlFile = sourceFiles.filter((file) => file.name.endsWith('.cmr.xml'));
  if (xmlFile.length === 1) {
    return exports.updateMetadata(granuleId, xmlFile[0], sourceFiles, distEndpoint, published);
  }
  else if (xmlFile.length > 1) {
    log.error('more than one.cmr.xml found');
  }
  return Promise.resolve();
};
