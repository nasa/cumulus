function getCmrHost(cmrEnvironment?: string): string {
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
  return `https://${host ?? getCmrHost(cmrEnv)}/ingest/providers/${provider}/`;
}

export function getSearchUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${host ?? getCmrHost(cmrEnv)}/search/`;
}

export function getTokenUrl({
  host,
  cmrEnv = process.env.CMR_ENVIRONMENT,
}: {
  host?: string,
  cmrEnv?: string,
} = {}): string {
  return `https://${host ?? getCmrHost(cmrEnv)}/legacy-services/rest/tokens`;
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
  return `https://${host ?? getCmrHost(cmrEnv)}/ingest/providers/${provider}/validate/`;
}
