# Provider Gateway

A long running service that will download files from a variety of URLs and upload to S3. It interacts with step functions for the Activity API.

Providers support a limited number of connections for downloading data. AWS infrastructure like lambdas could easily scale up beyond the number of connections a provider supports. We must fully utilize the connections that are available. The Provider Gateway sets up persistent connections to the providers up to the limit configured. It reads download requests from the Step Function Activity API and queues the requests be processed. Every connection has a single thread that downloads data from the provider to S3 as fast as it can to attempt to fully utilize the limited resource.

## Building

TODO

## Running

TODO

## Configuration

The provider gateway is configured through the `collections.yml` file in each provider.

### Example Configuration:

```YAML
providers:
  - id: HTTP_PROV
    config:
      gateway_config:
        activity_arn: GitcResource! HttpProvDownloadActivity
        sync_activity_arn: GitcResource! HttpProvSyncActivity
        conn_config:
          type: http
        num_connections: 2
  - id: FTP_PROV
    config:
      gateway_config:
        activity_arn: GitcResource! FtpProvDownloadActivity
        sync_activity_arn: GitcResource! FtpProvSyncActivity
        conn_config:
          type: ftp
          host: 123.123.123.123
          port: 21
          username: user
          password: password
        num_connections: 2
```

### Fields in Gateway Config

TODO finish this section

The following fields are configured per provider.

* `activity_arn` - The AWS ARN of the step function activity receiving download requests
  * Note separate ARNs per provider because each activity is essentially a queue we want separate queues per provider so that one provider with more limited resources does not hold up another provider.
* `sync_activity_arn` - The AWS ARN of the step function activity receiving requests to synchronize
* `conn_config` -
* `num_connections` -

## Message Structure

### Download Message Request Structure

TODO finish this section


The input to

Stuff to include
* Sync request
* Download request
* version
* size

### Sync Message Request Structure

TODO


## TODOs

* Document design
* Add real example of jobs with providers and configuration.
  * Test parallelism. Can we have multiple state machines running with multiple downloads on a single provider and they're actually downloading at the same time?
* TODOs in code
* Document README
* More Protocols
  * SFTP
  * Grid FTP - How would I test this?
* Patrick comments
  * Figure out how we do container versions and tie that into code
    * How do we have multiple developers working on it and deploying newer versions?
    * How do we specify the version in UAT, ops, sit etc?
    * Maybe never commit version "latest" to master
  * Size
    * Make size optional (but try to fetch if not present)
    * Try to determine it if not present.
      * Use FTP mechanism (?)
      * HEAD request in HTTP to get Content-Length
  * Try using just version in the metadata for S3 and skip all the complicated sync logic.
