---
id: configure-cloudwatch-logs-delivery
title: API Gateway Logs Delivery
hide_title: true
---

# Configure API Gateway CloudWatch Logs Delivery

It is possible to deliver CloudWatch API execution and access logs to a cross-account shared AWS::Logs::Destination. An operator does this by configuring the `cumulus` module for [your deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module) as shown below. The value of the `log_destination_arn` variable is the ARN of a writable log destination.

```hcl
log_api_gateway_to_cloudwatch = true
log_destination_arn           = arn:aws:[logs|kinesis]:us-east-1:123456789012:[destination:logDestinationName|streamName]
```

The value can be either an [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) ARN to which your account can write.

For NASA/NGAP deployments an operator should make a request to the metrics team for write access and the correct shared Logs Destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.
