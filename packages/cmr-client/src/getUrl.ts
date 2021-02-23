interface CmrHostParams {
  cmrEnvironment: string | undefined,
  cmrHost: string | undefined
}

/**
 * Get host to use for CMR requests.
 *
 * @param {Object} params
 * @param {string} [params.cmrEnvironment]
 *  CMR environment logical name to use for requests.
 * @param {string} [params.cmrHost]
 *  Custom host name to use for CMR requests.
 * @returns {string}
 * @private
 **/
export function getCmrHost({
  cmrEnvironment = process.env.CMR_ENVIRONMENT,
  cmrHost = process.env.CMR_HOST,
}: CmrHostParams = {} as CmrHostParams): string {
  if (cmrHost) {
    return cmrHost;
  }
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
  return `https://${getCmrHost({ cmrEnvironment: cmrEnv, cmrHost: host })}/ingest/providers/${provider}/`;
}

export function getSearchUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${getCmrHost({ cmrEnvironment: cmrEnv, cmrHost: host })}/search/`;
}

export function getTokenUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${getCmrHost({ cmrEnvironment: cmrEnv, cmrHost: host })}/legacy-services/rest/tokens`;
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
  return `https://${getCmrHost({ cmrEnvironment: cmrEnv, cmrHost: host })}/ingest/providers/${provider}/validate/`;
}
