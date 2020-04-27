/**
 * @module SecretsManager
 */

import { secretsManager } from './services';

export const getSecretString = (SecretId: string) =>
  secretsManager().getSecretValue({ SecretId }).promise()
    .then((response) => response.SecretString);
