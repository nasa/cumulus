---
id: version-v1.14.0-enable-api-logs
title: Enable API Gateway Logging
hide_title: true
original_id: enable-api-logs
---

# Enable API Gateway Logs

In order to enable API Access and Execution logging, configure the Cumulus deployment by setting `logApigatewayToCloudwatch` on the `apiConfig`'s API.

For example to enable API logging on the Distribution API:

```yml
  apiConfigs:
    backend:
      private: true
    distribution:
      private: true
      logApiGatewayToCloudWatch: true
```

This enables the distribution API to send it's logs to the default CloudWatch location: `API-Gateway-Execution-Logs_<RESTAPI_ID>/<STAGE>`
