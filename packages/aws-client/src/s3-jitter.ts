import Logger from '@cumulus/logger';
import { sleep } from '@cumulus/common';

const log = new Logger({ sender: 's3-jitter' });

/**
 * Introduces random jitter delay to stagger concurrent S3 operations.
 * This helps prevent AWS S3 SlowDown errors when many operations occur simultaneously.
 *
 * @param maxJitterMs - Maximum jitter time in milliseconds (0-59000).
 *   If 0, no delay is applied.
 * @param operation - Optional operation name for logging context
 * @returns A Promise that resolves after the random delay
 */
export const applyS3Jitter = async (
  maxJitterMs: number,
  operation?: string
): Promise<void> => {
  if (maxJitterMs <= 0) {
    return;
  }

  const jitterMs = Math.ceil(Math.random() * maxJitterMs);

  const logContext = operation ? ` for ${operation}` : '';
  log.info(`Applying S3 jitter: ${jitterMs}ms${logContext} (max: ${maxJitterMs}ms)`);

  await sleep(jitterMs);

  log.debug(`S3 jitter delay completed: ${jitterMs}ms${logContext}`);
};
