const moment = require('moment');
const { deleteS3Object, getJsonS3Object, putJsonS3Object, S3ListObjectsV2Queue } = require('@cumulus/aws-client');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });
export interface HandlerEvent {
  dlaPath?: string
}

export const handler = async (event: HandlerEvent): Promise<void> => {
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;

  const dlaPath = event.dlaPath ? event.dlaPath : `${stackName}/dead-letter-archive/sqs/`;
  const lastIndexOfDlaPathSeparator = dlaPath.lastIndexOf('/');

  let fileCount = 0;
  const s3ObjectsQueue = new S3ListObjectsV2Queue({
    Bucket: systemBucket,
    Prefix: dlaPath,
  });
  /* eslint-disable no-await-in-loop */
  while (await s3ObjectsQueue.peek()) {
    const s3Object = await s3ObjectsQueue.shift();
    logger.info(`About to process ${s3Object}`);
    // skip directories and files on subfolder
    if (s3Object.endsWith('.json') && s3Object.lastIndex('/') === lastIndexOfDlaPathSeparator) {
      const deadLetterMessage = await getJsonS3Object(systemBucket, s3Object);
      const dateString = deadLetterMessage.time
        ? moment.utc(deadLetterMessage.time).format('YYYY-MM-DD') : moment.utc().format('YYYY-MM-DD');
      const destinationKey = `${dlaPath}${dateString}/${s3Object.split('/').pop()}`;
      await putJsonS3Object(
        systemBucket,
        destinationKey,
        deadLetterMessage
      );
      logger.info(`Migrated file from bucket ${systemBucket}/${s3Object} to ${destinationKey}`);
      await deleteS3Object(
        systemBucket,
        s3Object
      );
      logger.info(`Deleted file ${systemBucket}/${s3Object}`);
      fileCount += 1;
    }
  }
  /* eslint-enable no-await-in-loop */

  logger.info(`Completed DLA migration, migrated ${fileCount} files`);
};
