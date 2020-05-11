'use strict';

const S3 = require('@cumulus/aws-client/S3');

const GB = 1024 * 1024 * 1024;

const copyObject = async ({
  sourceBucket,
  sourceKey,
  destinationBucket,
  destinationKey
}) => {
  const objectSize = await S3.getObjectSize(sourceBucket, sourceKey);

  if (objectSize > (5 * GB)) {
    await S3.multipartCopyObject({
      sourceBucket,
      sourceKey,
      destinationBucket,
      destinationKey
    });
  } else {
    await S3.s3CopyObject({
      Bucket: destinationBucket,
      CopySource: `${sourceBucket}/${sourceKey}`,
      Key: destinationKey
    });
  }
};

module.exports = {
  copyObject
};
