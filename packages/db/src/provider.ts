const omit = require('lodash/omit');
const isNil = require('lodash/isNil');
const isValidHostname = require('is-valid-hostname');
const { RDSValidationError } = require('@cumulus/errors');
const KMS = require('@cumulus/aws-client/KMS');

const encryptValueWithKMS = (value: string) =>
  KMS.encrypt(process.env.provider_kms_key_id, value);

export const rdsProviderFromCumulusProvider = async (
  data: any
) => {
  let username: string | undefined;
  let password: string | undefined;
  if (data.username) {
    username = await encryptValueWithKMS(data.username);
  }
  if (data.password) {
    password = await encryptValueWithKMS(data.password);
  }
  return ({
    ...(omit(data, ['id', 'encrypted', 'createdAt', 'updatedAt'])),
    name: data.id,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
    username,
    password,
  });
};

// TODO - data shouldn't be any
export const nullifyUndefinedProviderValues = async (data: any) => {
  const returnData = { ...data };
  const optionalValues = ['port', 'username', 'password', 'globalConnectionLimit', 'privateKey', 'cmKeyId', 'certificateUri'];
  optionalValues.forEach((value) => {
    // eslint-disable-next-line unicorn/no-null
    returnData[value] = returnData[value] ? returnData[value] : null;
  });
  return returnData;
};

export const validateProviderHost = (host: string) => {
  if (isNil(host)) return;
  if (isValidHostname(host)) return;

  const error = new RDSValidationError('The record has validation errors');
  error.detail = `${host} is not a valid hostname or IP address`;
  throw error;
};
