const omit = require('lodash/omit');
const isNil = require('lodash/isNil');
const isValidHostname = require('is-valid-hostname');
const { RDSValidationError } = require('@cumulus/errors');

export const rdsProviderFromCumulusProvider = async (
  data: any
) => ({
  ...(omit(data, ['id', 'encrypted', 'createdAt', 'updatedAt'])),
  name: data.id,
  created_at: data.createdAt,
  updated_at: data.updatedAt,
});

export const validateProviderHost = (host: string) => {
  if (isNil(host)) return;
  if (isValidHostname(host)) return;

  const error = new RDSValidationError('The record has validation errors');
  error.detail = `${host} is not a valid hostname or IP address`;
  throw error;
};
