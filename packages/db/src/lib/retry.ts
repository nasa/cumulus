'use strict';

import { Knex } from 'knex';
import pRetry from 'p-retry';
import Logger from '@cumulus/logger';

type PromiseReturnType<T> = T extends (
  method: Promise<any> | Knex.QueryBuilder
) => infer R ? Promise<R> : never;

export const RetryOnDbConnectionTerminateError = async <T>(
  method: Promise<any> | Knex.QueryBuilder,
  retryConfig?: pRetry.Options,
  log?: Logger): Promise<PromiseReturnType<T>> => {
  const logger = log || new Logger({ sender: '@cumulus/db/retry' });
  return await pRetry(
    async () => {
      try {
        const result = await method;
        return result;
      } catch (error) {
        if (error.message.includes('Connection terminated unexpectedly')) {
          logger.error(`${error}. Retrying...`);
          throw error;
        }
        throw new pRetry.AbortError(error);
      }
    },
    {
      retries: 3,
      onFailedAttempt: (e) => {
        logger.error(`Error ${e.message}. Attempt ${e.attemptNumber} failed.`);
      },
      ...retryConfig,
    }
  );
};
