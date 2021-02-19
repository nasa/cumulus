/**
 * Get host to use for CMR requests.
 *
 * @param {string} [cmrEnvironment]
 *  CMR environment to use for requests. Can be a CMR environment "logical"
 *  name or a full custom host name.
 * @returns {string} - CMR host
 * @private
 **/
export function getCmrHost(
  cmrEnvironment: string | undefined = process.env.CMR_ENVIRONMENT
): string {
  if (!cmrEnvironment) {
    throw new TypeError('CMR environment must be defined');
  }
  let cmrHost;
  switch (cmrEnvironment) {
    case 'OPS':
      cmrHost = 'cmr.earthdata.nasa.gov';
      break;
    case 'UAT':
      cmrHost = 'cmr.uat.earthdata.nasa.gov';
      break;
    case 'SIT':
      cmrHost = 'cmr.sit.earthdata.nasa.gov';
      break;
    default:
      cmrHost = cmrEnvironment;
  }
  return cmrHost;
}

export function getIngestUrl({
  cmrEnv,
  provider,
}: {
  cmrEnv?: string,
  provider: string,
}): string {
  return `https://${getCmrHost(cmrEnv)}/ingest/providers/${provider}/`;
}

export function getSearchUrl({
  cmrEnv,
}: {
  cmrEnv?: string,
} = {}): string {
  return `https://${getCmrHost(cmrEnv)}/search/`;
}

export function getTokenUrl({
  cmrEnv,
}: {
  cmrEnv?: string,
} = {}): string {
  return `https://${getCmrHost(cmrEnv)}/legacy-services/rest/tokens`;
}

export function getValidateUrl({
  cmrEnv,
  provider,
}: {
  cmrEnv?: string,
  provider: string,
}): string {
  return `https://${getCmrHost(cmrEnv)}/ingest/providers/${provider}/validate/`;
}
