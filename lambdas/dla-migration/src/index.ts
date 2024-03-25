const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/dla-migration-lambda' });
export interface HandlerEvent {
  dlaPath?: string
}

export const handler = async (event: HandlerEvent): Promise<void> => {
  const systemBucket = process.env.system_bucket;
  const stackName = process.env.stackName;

  const dlaPath = event.dlaPath ? event.dlaPath : `${stackName}/dead-letter-archive/sqs/`;
  logger.info(systemBucket);
  logger.info(dlaPath);
  logger.info(JSON.stringify(event));
};
