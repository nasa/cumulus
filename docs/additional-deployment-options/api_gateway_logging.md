---
id: enable-api-logs
title: Enable API Gateway Logging
hide_title: true
---

# Enable API Gateway Logs

In order to enable API Access and Execution logging, configure the Cumulus deployment by setting `log_api_gateway_to_cloudwatch` on the `cumulus` module .

For example to enable API logging on the Distribution API:

```hcl
log_api_gateway_to_cloudwatch = true
```

This enables the distribution API to send its logs to the default CloudWatch location: `API-Gateway-Execution-Logs_<RESTAPI_ID>/<STAGE>`
