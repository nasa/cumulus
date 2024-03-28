import moment from 'moment';
import { deleteS3Object, getJsonS3Object, putJsonS3Object } from '@cumulus/aws-client/S3';
import S3ListObjectsV2Queue from '@cumulus/aws-client/S3ListObjectsV2Queue';
import Logger from '@cumulus/logger';

const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });
export interface HandlerEvent {
  dlaPath?: string
}

export interface HandlerOutput {
  migrated: number
}

export const handler = async (event: HandlerEvent): Promise<HandlerOutput> => {
  const systemBucket = process.env.system_bucket || '';
  const stackName = process.env.stackName || '';

  const dlaPath = event.dlaPath ?? `${stackName}/dead-letter-archive/sqs/`;
  const lastIndexOfDlaPathSeparator = dlaPath.lastIndexOf('/');

  let fileCount = 0;
  const s3ObjectsQueue = new S3ListObjectsV2Queue({
    Bucket: systemBucket,
    Prefix: dlaPath,
  });

  /* eslint-disable no-await-in-loop */
  while (await s3ObjectsQueue.peek()) {
    const s3Object = await s3ObjectsQueue.shift();
    const s3ObjectKey = s3Object?.Key;

    logger.info(`About to process ${s3ObjectKey}`);
    // skip directories and files on subfolder
    if (s3ObjectKey && s3ObjectKey.endsWith('.json') && s3ObjectKey.lastIndexOf('/') === lastIndexOfDlaPathSeparator) {
      const deadLetterMessage = await getJsonS3Object(systemBucket, s3ObjectKey);
      const dateString = moment.utc(deadLetterMessage.time).format('YYYY-MM-DD');
      const destinationKey = `${dlaPath}${dateString}/${s3ObjectKey.split('/').pop()}`;

      await putJsonS3Object(
        systemBucket,
        destinationKey,
        deadLetterMessage
      );
      logger.info(`Migrated file from bucket ${systemBucket}/${s3ObjectKey} to ${destinationKey}`);

      await deleteS3Object(
        systemBucket,
        s3ObjectKey
      );
      logger.info(`Deleted file ${systemBucket}/${s3ObjectKey}`);

      fileCount += 1;
    }
  }
  /* eslint-enable no-await-in-loop */

  logger.info(`Completed DLA migration, migrated ${fileCount} files`);
  return { migrated: fileCount };
};
