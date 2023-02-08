const testBulkPayloadEnvVarsMatchSetEnvVars = (t, payload, knexDebugValue = 'false') => {
  Object.keys(payload.envVars).forEach((envVarKey) => {
    if (envVarKey === 'KNEX_DEBUG') {
      t.is(payload.envVars.KNEX_DEBUG, knexDebugValue);
    } else {
      t.is(payload.envVars[envVarKey], process.env[envVarKey]);
    }
  });
};

module.exports = { testBulkPayloadEnvVarsMatchSetEnvVars };
