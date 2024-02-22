/**
 * @module SecretsManager
 */

import { secretsManager } from './services';

export const getSecretString = async (SecretId: string) =>
  secretsManager().getSecretValue({ SecretId })
    .then((response) => response.SecretString);
