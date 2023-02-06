---
id: version-v1.19.0-cloudwatch-logs-delivery
title: Configure Cloudwatch Logs Delivery
hide_title: true
original_id: cloudwatch-logs-delivery
---

# Configure Cloudwatch Logs Delivery

As an optional configuration step, it is possible to deliver CloudWatch logs to a cross-account shared AWS::Logs::Destination. An operator does this by configuring the `cumulus` module for [your deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module) as shown below. The value of the `log_destination_arn` variable is the ARN of a writeable log destination.

The value can be either an [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) ARN to which your account can write.

```hcl
log_destination_arn           = arn:aws:[kinesis|logs]:us-east-1:123456789012:[streamName|destination:logDestinationName]
```

## Logs Sent

Be default, the following logs will be sent to the destination when one is given.

* Ingest logs
* Async Operation logs
* API Gateway logs (if `log_api_gateway_to_cloudwatch` is set to true)

## Additional Logs

If additional logs are needed, you can configure `additional_log_groups_to_elk` with the Cloudwatch log groups you want to send to the destination. `additional_log_groups_to_elk` is a map with the key as a descriptor and the value with the Cloudwatch log group name.

```hcl
additional_log_groups_to_elk = {
  "HelloWorldTask" = "/aws/lambda/cumulus-example-HelloWorld"
  "MyCustomTask" = "my-custom-task-log-group"
}
```

## ESDIS Metrics

For NASA/NGAP deployments an operator should make a request to the metrics team for write access and the correct shared Logs Destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.

To be able to access logs sent to the Metrics ELK stack through the `/logs` endpoint, be sure to also configure the metrics variables.

```hcl
metrics_es_host = "metricshost.cloudfront.net"
metrics_es_username = "user"
metrics_es_password = "password"
```
