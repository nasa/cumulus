# Cumulus

## Project Description

This Cumulus project seeks to address the existing need for a “native” cloud-based data ingest, archive, distribution, and management system that can be used for all future Earth Observing System Data and Information System (EOSDIS) data streams via the development and implementation of Cumulus. The term “native” implies that the system will leverage all components of a cloud infrastructure provided by the vendor for efficiency (in terms of both processing time and cost). Additionally, Cumulus will operate on future data streams involving satellite missions, aircraft missions, and field campaigns. 

This documentation includes both guidelines, examples and source code docs.

The documentation is accessible at https://cumulus-nasa.github.io/

## Contributing

Please refer to: https://github.com/cumulus-nasa/cumulus/blob/master/CONTRIBUTING.md for information

# Content

### Documentation

* [Architecture](architecture.md)
* [Cumulus Deployment](deployment/README.md)
  * [Creating an S3 Bucket](deployment/create_bucket.md)
  * [Locating IAMs](deployment/iam_roles.md)
  * [Troubleshooting Deployment](deployment/troubleshoot_deployment.md)
* [Cumulus Workflows](workflows/README.md)
  * [Protocol](workflows/protocol.md)
  * [Input & Ouptut](workflows/input_output.md)
  * [Cumulus Task Message Flow](workflows/cumulus-task-message-flow.md)
  * [Developing Workflow Tasks](workflows/developing-workflow-tasks.md)
    * [Lambda Functions](workflows/lambda.md)
    * [Dockerization](workflows/docker.md)
  * [Workflow Configuration How-to's](workflows/workflow-configuration-how-to.md)
* [Tasks](tasks.md)
* [Cumulus API](https://cumulus-nasa.github.io/cumulus-api)
* [Backup and Restore](backup_and_restore.md)
* [EMS Reporting](ems_reporting.md)

* [Local Docs](doc_installation.md)
  * [Adding a task](adding-a-task.md)
* [Upgrade Instructions](upgrade/README.md)
  * [1.6.0](upgrade/1.6.0.md)
  * [1.7.0](upgrade/1.7.0.md)
* [Changelog](https://github.com/cumulus-nasa/cumulus/blob/master/CHANGELOG.md)
* [Team](team.md)


### Data Cookbook

* [About Cookbooks](data-cookbooks/about-cookbooks.md)
* [HelloWorldWorkflow](data-cookbooks/hello-world.md)
* [SNS Configuration](data-cookbooks/sns.md)