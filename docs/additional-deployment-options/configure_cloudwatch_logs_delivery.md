---
id: configure-cloudwatch-logs-delivery
title: Configure CloudWatch Logs Delivery
hide_title: true
---

# Configure CloudWatch Logs Delivery


It is possible to deliver CloudWatch API execution and access logs to a cross-account shared AWS::Logs::Destination. An operator does this by adding the key `logToSharedDestination` to the `config.yml` at the default level with a value of a writable log destination.

```yaml
default:
  logToSharedDestination: arn:aws:logs:us-east-1:123456789012:destination:CumulusLogDestination
```
The value can be either an [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) Arn to which your account can write.

For NASA/NGAP deployments an operator should make a request to the metrics team for write access and the correct shared Logs Destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.
