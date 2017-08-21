# Provider Gateway

A long running service that will download files from a variety of URLs and upload to S3. It interacts with step functions for the Activity API.

Providers support a limited number of connections for downloading data. AWS infrastructure like lambdas could easily scale up beyond the number of connections a provider supports. We must fully utilize the connections that are available. The Provider Gateway sets up persistent connections to the providers up to the limit configured. It reads download requests from the Step Function Activity API and queues the requests be processed. Every connection has a single thread that downloads data from the provider to S3 as fast as it can to attempt to fully utilize the limited resource.

## Building and Deploying

**As of this writing the building and deploying of Provider Gateway is not part of Cumulus proper. It must be manually built and deployed to a container registry**

A container can be build and deployed to AWS ECR by running `bin/docker_deploy.sh`

```Bash
export AWS_DEFAULT_REGION=us-west-2
bin/docker_deploy.sh
```

## Running Locally

Running the Provider Gateway locally is best done in a Clojure REPL.

1. Make sure you have [Leiningen](https://leiningen.org/) and Java installed.
2. Create the file `dev/locals.clj` with contents set appropriately.  (See below)
3. Edit `dev/user.clj` to set how the system will be configured. There are settings to pull config from AWS or run locally with the file system as the activity API.

### Locals.clj sample contents

Place contents like the following in `dev/locals.clj`.

```Clojure
(ns locals)

(def defaults
  {"AWS_ACCOUNT_ID" "1234567"
   "AWS_DEFAULT_REGION" "us-west-2"
   "STACK_NAME" "gitc-xx"})
```

## Configuration

### Provider Configuration

The provider gateway is configured through the `collections.yml` file in each provider.

#### Example Provider Configuration:

```YAML
providers:
  - id: HTTP_PROV
    config:
      gateway_config:
        activity: HttpProvDownloadActivity
        sync_activity: HttpProvSyncActivity
        conn_config:
          conn_type: http
        num_connections: 2
  - id: FTP_PROV
    config:
      gateway_config:
        activity: FtpProvDownloadActivity
        sync_activity: FtpProvSyncActivity
        conn_config:
          conn_type: ftp
          host: 123.123.123.123
          port: 21
          username: user
          password: password
        num_connections: 2
  - id: SFTP_PROV
    config:
      gateway_config:
        activity: SftpProvDownloadActivity
        sync_activity: SftpProvSyncActivity
        conn_config:
          conn_type: sftp
          host: 123.123.123.123
          port: 21
          username: user
          password: password
        num_connections: 2
```

#### Fields in Provider Gateway Config

The following fields are configured per provider.

* `activity` - The CloudFormation name of the step function activity receiving download requests
  * Note separate ARNs per provider because each activity is essentially a queue we want separate queues per provider so that one provider with more limited resources does not hold up another provider.
* `sync_activity` - The CloudFormation name of the step function activity receiving requests to synchronize
* `conn_config` - Configuration settings per connection type. See example for valid fields.
* `num_connections` - The number of threads to allocate for downloading data from a provider.

#### Download and Sync Task Config

The download and sync task configurations are configured in the `workflow_config_template` element of the message structure. The tasks names are "DownloadActivity" and "SyncHttpUrls" respectively.

* `bucket` - Configures the name of the bucket in S3 to upload items
* `key_prefix` - A prefix to use for generating a key when uploading new items.

##### Example Task Config

```JSON
{"SyncHttpUrls": {
  "output": {
    "bucket": "{resources.buckets.private}",
    "key_prefix": "sources/EPSG{meta.epsg}/{meta.key}"
  }}
}
```

## Message Structure

The input and output message structure matches the message payload schema for Cumulus

### Download Message Request Structure

#### Download Message Input Payload Structure

Field descriptions

* `payload`
  * `files` - an array of file download requests
    * Each File Map
      * `type` - only `"download"` supported currently
      * `source`
        * `url` - Location of file to download
        * `version` - optional version number. This can help avoid unnecessary downloads if the file is already in S3.
        * `size` - Options size of the file to copy. Size is important to specify to avoid having to buffer the file in memory before copying to S3. If size is not present then the size will attempt to be determined via HTTP HEAD request, FTP ls, or similar.
      * `target` either `"FROM_CONFIG"` or a map with `bucket` and `key` of an S3 location


##### Example Download Message Input Payload

```JSON
{
  "... other fields here as in message": "...",
  "payload": {
    "other-keys": "other keys at this level and below are ignored and passed through to output",
    "files": [{
      "type": "download",
      "source": {
        "url": "http://example.com/foo/bar.txt",
        "version": "OptionalVersion",
        "size": 1234
      },
      "target": {
        "bucket": "the-bucket",
        "key": "bar.txt"
      }
    }, {
      "type": "download",
      "source": {
        "url": "http://example.com/foo/bar2.txt",
      },
      "target": "FROM_CONFIG"
    }]
  }
}
```

#### Download Message Output Payload Structure

The output is similar to the input structure but it has additional information.

```JSON
{
  "... other fields here as in message": "...",
  "payload": {
    "other-keys": "other keys at this level and below are ignored and passed through to output",
    "files": [{
      "type": "download",
      "source": {
        "url": "http://example.com/foo/bar.txt",
        "version": "v1"
      },
      "target": {
        "bucket": "the-bucket",
        "key": "bar.txt"
      },
      "success" : false,
      "error" : "The file did not exist at the source."
    }, {
      "type": "download",
      "source": {
        "url": "http://example.com/foo/bar2.txt",
        "version": "v1"
      },
      "target": {
        "bucket": "the-bucket",
        "key": "bar2.txt"
      },
      "success": true
    }]
  }
}
```

### Sync Message Request Structure

Synchronization messages can send a list of files and version to synchronize to S3.

#### Sync Message Input Payload Structure

The payload is a list of file urls and versions to synchronize.

```JSON
{
  "... other fields here as in message": "...",
  "payload" : [ {
      "url" : "http://example.com/foo/bar.txt",
      "version" : "bar-1"
    }, {
      "url" : "http://example.com/foo/bar2.txt",
      "version" : "bar2-1"
    } ]
  }
```
#### Sync Message Output Payload Structure

The output payload from synchronization is a list of S3 Bucket and Keys of the files that exist.

```JSON
{
  "... other fields here as in message": "...",
  "payload": [{
    "Bucket": "the-bucket",
    "Key": "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/bar.txt"
  }, {
    "Bucket": "the-bucket",
    "Key": "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/bar2.txt"
  }]
}
```
