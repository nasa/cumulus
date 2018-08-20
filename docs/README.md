# Cumulus

## Project Description

This Cumulus project seeks to address the existing need for a “native” cloud-based data ingest, archive, distribution, and management system that can be used for all future Earth Observing System Data and Information System (EOSDIS) data streams via the development and implementation of Cumulus. The term “native” implies that the system will leverage all components of a cloud infrastructure provided by the vendor for efficiency (in terms of both processing time and cost). Additionally, Cumulus will operate on future data streams involving satellite missions, aircraft missions, and field campaigns.

This documentation includes both guidelines, examples and source code docs.

The documentation is accessible at https://nasa.github.io/cumulus

## Contributing

Please refer to: https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md for information

# Content

### Documentation

* [Home](README.md)
* [Architecture](architecture.md)
* [What are Cumulus Workflows?](workflows/README.md)
  * [Workflow Protocol](workflows/protocol.md)
  * [Workflow Tasks](tasks.md)
  * [Workflow Input & Ouptut](workflows/input_output.md)
  * [Workflow Task Message Flow](workflows/cumulus-task-message-flow.md)
  * [Developing Workflow Tasks](workflows/developing-workflow-tasks.md)
    * [Lambda Functions](workflows/lambda.md)
    * [Dockerization](workflows/docker.md)
  * [Workflow Configuration How-to's](workflows/workflow-configuration-how-to.md)
* Deployment
  * [How to Deploy Cumulus](deployment/README.md)
  * [Creating an S3 Bucket](deployment/create_bucket.md)
  * [Locating IAMs](deployment/iam_roles.md)
  * [Troubleshooting Deployment](deployment/troubleshoot_deployment.md)
* [Cumulus API Docs](https://nasa.github.io/cumulus-api)
* Additional Cumulus Features
  * [Cumulus Metadata in DynamoDB](data_in_dynamodb.md#cumulus-metadata-in-dynamodb)
  * [DynamoDB Backup and Restore](data_in_dynamodb.md#backup-and-restore-with-aws)
  * [DynamoDB Auto Scaling](data_in_dynamodb.md#dynamodb-auto-scaling)
  * [EMS Reporting](ems_reporting.md)
* [Changelog](https://github.com/nasa/cumulus/blob/master/CHANGELOG.md)
* [Upgrade Instructions](upgrade/README.md)
  * [1.6.0](upgrade/1.6.0.md)
  * [1.7.0](upgrade/1.7.0.md)
  * [1.9.0](upgrade/1.9.0.md)
* [Operating and Troubleshooting](system-documentation/system-documentation.md)
* [Contributing to documentation](doc_installation.md)
  * [Adding a task](adding-a-task.md)
* [Team](team.md)

### Data Cookbook

* [About Cookbooks](data-cookbooks/about-cookbooks.md)
  * [Collections, Providers, Schemas, and Rules](data-cookbooks/setup.md)
* [HelloWorldWorkflow](data-cookbooks/hello-world.md)
* [SNS Configuration](data-cookbooks/sns.md)
* [SIPS Workflow](data-cookbooks/sips-workflow.md)