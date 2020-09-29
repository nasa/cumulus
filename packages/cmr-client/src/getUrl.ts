/**
 * Determines the appropriate CMR host endpoint based on a given
 * value for CMR_ENVIRONMENT environment variable. Defaults
 * to the uat cmr
 *
 * @param {string} cmrEnvironment - [optional] CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT'], anything that is
 *              not 'OPS' or 'SIT' will be interpreted as 'UAT'
 * @returns {string} the cmr host address
 */
function getHost(cmrEnvironment?: string): string {
  switch (cmrEnvironment) {
    case 'OPS':
      return 'cmr.earthdata.nasa.gov';
    case 'UAT':
      return 'cmr.uat.earthdata.nasa.gov';
    case 'SIT':
      return 'cmr.sit.earthdata.nasa.gov';
    default:
      throw new TypeError(`Invalid CMR environment: ${cmrEnvironment}`);
  }
}

export function getIngestUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
  provider,
}: {
  host?: string,
  cmrEnv?: string,
  provider: string,
}): string {
  return `https://${host ?? getHost(cmrEnv)}/ingest/providers/${provider}/`;
}

export function getSearchUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${host ?? getHost(cmrEnv)}/search/`;
}

export function getTokenUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${host ?? getHost(cmrEnv)}/legacy-services/rest/tokens`;
}

export function getValidateUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
  provider,
}: {
  host?: string,
  cmrEnv?: string,
  provider: string,
}): string {
  return `https://${host ?? getHost(cmrEnv)}/ingest/providers/${provider}/validate/`;
}
