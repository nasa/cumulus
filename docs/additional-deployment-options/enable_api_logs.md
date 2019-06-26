---
id: enable-api-logs
title: Enable API Gateway Logging
hide_title: true
---

# Enable API Gateway Logs

In order to log API Access and Execution logging, configure the deployment `config.yml` by setting `logApigatewayToCloudwatch` on `apiConfig` for the appropriate API.

For example to enable api logging on the Distribution API:

```yml
  apiConfigs:
    backend:
      private: true
    distribution:
      private: true
      logApiGatewayToCloudWatch: true
```

This enables the distribution API to send it's logs to the default CloudWatch location: `API-Gateway-Execution-Logs_<RESTAPI_ID>/<STAGE>`
