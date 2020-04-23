const awsServices = require('./services');

exports.getSecretString = (SecretId) =>
  awsServices.secretsManager().getSecretValue({ SecretId }).promise()
    .then((response) => response.SecretString);
