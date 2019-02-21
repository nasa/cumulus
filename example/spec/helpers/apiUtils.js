function setDistributionApiEnvVars() {
  process.env.PORT = 5002;
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${process.env.PORT}`;
  // Ensure integration tests use Earthdata login UAT if not specified.
  if (!process.env.EARTHDATA_BASE_URL) {
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  }
}

module.exports = {
  setDistributionApiEnvVars
};
