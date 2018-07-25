const aws = require('./aws');
const encodeurl = require('encodeurl');

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
exports.copyGranuleFile = (source, target, options) {
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
}

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
exports.moveGranuleFile = async (source, target, options) {
  await exports.copyGranuleFile(source, target, options);
  return aws.s3().deleteObject(source).promise();
}

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
exports.moveGranuleFiles = async (granuleId, sourceFiles, destinations, distEndpoint, published) {
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
      return moveGranuleFile(source, target).then(() => { /* eslint-disable no-param-reassign */
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
    return updateMetadata(granuleId, xmlFile[0], sourceFiles, distEndpoint, published);
  }
  else if (xmlFile.length > 1) {
    log.error('more than one.cmr.xml found');
  }
  return Promise.resolve();
}
