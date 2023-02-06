---
id: version-v1.14.0-configure-cloudwatch-logs-delivery
title: API Gateway Logs Delivery
hide_title: true
original_id: configure-cloudwatch-logs-delivery
---

# Configure API Gateway CloudWatch Logs Delivery

It is possible to deliver CloudWatch API execution and access logs to a cross-account shared AWS::Logs::Destination. An operator does this by adding the key `logToSharedDestination` whose value is a writable log destination to the default level of the Cumulus `config.yml`.

```yaml
default:
  logToSharedDestination: arn:aws:logs:us-east-1:123456789012:destination:CumulusLogDestination
```
The value can be either an [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) ARN to which your account can write.

For NASA/NGAP deployments an operator should make a request to the metrics team for write access and the correct shared Logs Destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.
