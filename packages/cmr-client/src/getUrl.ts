/**
 * Returns the environment specific identifier for the input cmr environment.
 * @param {string} env - cmr environment ['OPS', 'SIT', 'UAT']
 * @returns {string} - value to use to build correct cmr url for environment.
 */
function hostId(env?: string): string {
  switch (env) {
    case 'OPS':
      return '';
    case 'UAT':
      return 'uat';
    case 'SIT':
    default:
      return 'sit';
  }
}

/**
 * Determines the appropriate CMR host endpoint based on a given
 * value for CMR_ENVIRONMENT environment variable. Defaults
 * to the uat cmr
 *
 * @param {string} cmrEnvironment - [optional] CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT'], anything that is
 *              not 'OPS' or 'SIT' will be interpreted as 'UAT'
 * @param {string} cmrHost [optional] explicit host to return, if
 *              this has a value, it overrides any values for cmrEnvironment
 * @returns {string} the cmr host address
 */
function getHost(cmrEnvironment?: string, cmrHost?: string): string {
  if (cmrHost) return cmrHost;

  return ['cmr', hostId(cmrEnvironment), 'earthdata.nasa.gov'].filter((d) => d).join('.');
}

/**
 * returns the full url for various cmr services
 * based on the type passed, e.g. token, search, etc.
 *
 * @param {string} type - the type of the service, e.g. token, search
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} cmrEnvironment - CMR environment to
 *              use valid arguments are ['OPS', 'SIT', 'UAT']
 * @param {string} cmrHost - CMR host
 * @returns {string} the cmr url
 */
function getUrl(
  type: string,
  cmrProvider: string,
  cmrEnvironment?: string,
  cmrHost?: string
): string | null {
  const cmrEnv = cmrEnvironment ?? process.env.CMR_ENVIRONMENT;

  const host = getHost(cmrEnv, cmrHost);

  switch (type) {
    case 'token':
      if (cmrEnv === 'OPS') {
        return 'https://cmr.earthdata.nasa.gov/legacy-services/rest/tokens';
      }
      return 'https://cmr.uat.earthdata.nasa.gov/legacy-services/rest/tokens';
    case 'search':
      return `https://${host}/search/`;
    case 'validate':
      return `https://${host}/ingest/providers/${cmrProvider}/validate/`;
    case 'ingest':
      return `https://${host}/ingest/providers/${cmrProvider}/`;
    default:
      return null; // eslint-disable-line unicorn/no-null
  }
}

export = getUrl;
