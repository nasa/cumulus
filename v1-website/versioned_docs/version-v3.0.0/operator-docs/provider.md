---
id: version-v3.0.0-provider
title: Provider Configuration
hide_title: false
original_id: provider
---

In Cumulus, a Provider represents a endpoint from which data is ingested.   For example, a HTTP server serving data from a data provider, or an S3 bucket deployed within your organization with data staged for ingest into Cumulus.

Please note:

* While *connection* configuration is defined here, things that are more specific to a specific ingest setup (e.g. 'What target directory should we be pulling from' or 'How is duplicate handling configured?') are generally defined in a Rule or Collection, not the Provider.
* There is some provider behavior which is controlled by task-specific configuration and not the provider definition. This configuration has to be set on a **per-workflow** basis. For example, see the [`httpListTimeout` configuration on the `discover-granules` task](https://github.com/nasa/cumulus/blob/master/tasks/discover-granules/schemas/config.json#L84)

A Provider can be created via use of the [API](https://nasa.github.io/cumulus-api/#create-provider) or via a client application like the [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard).

## Provider Configuration

The Provider configuration is defined by a JSON object that takes different configuration keys depending on the provider type.    The following are definitions of typical configuration values relevant for the various providers:

### S3

|Key  |Type |Required|Description|
|:---:|:----|:------:|-----------|
|id|string|Yes|Unique identifier for the provider|
|globalConnectionLimit|integer|No|Integer specifying the connection limit for the provider. This is the maximum number of connections Cumulus compatible ingest lambdas are expected to make to a provider.  Defaults to unlimited |
|protocol|string|Yes|The protocol for this provider. Must be `s3` for this provider type. |
|host|string|Yes|S3 Bucket to pull data from |

### http

|Key  |Type |Required|Description|
|:---:|:----|:------:|-----------|
|id|string|Yes|Unique identifier for the provider|
|globalConnectionLimit|integer|No|Integer specifying the connection limit for the provider.  This is the maximum number of connections Cumulus compatible ingest lambdas are expected to make to a provider.  Defaults to unlimited |
|protocol|string|Yes|The protocol for this provider.  Must be `http` for this provider type |
|host|string|Yes|The host to pull data from (e.g. `nasa.gov`)
|username|string|No|Configured username for basic authentication.   Cumulus encrypts this using KMS and uses it in a `Basic` auth header if needed for authentication |
|password|string|*Only if username is specified*|Configured password for basic authentication.   Cumulus encrypts this using KMS and uses it in a `Basic` auth header if needed for authentication |
|port|integer|No|Port to connect to the provider on.   Defaults to `80`|

### https

|Key  |Type |Required|Description|
|:---:|:----|:------:|-----------|
|id|string|Yes|Unique identifier for the provider|
|globalConnectionLimit|integer|No|Integer specifying the connection limit for the provider.  This is the maximum number of connections Cumulus compatible ingest lambdas are expected to make to a provider.  Defaults to unlimited |
|protocol|string|Yes|The protocol for this provider.  Must be `https` for this provider type |
|host|string|Yes|The host to pull data from (e.g. `nasa.gov`) |
|username|string|No|Configured username for basic authentication.   Cumulus encrypts this using KMS and uses it in a `Basic` auth header if needed for authentication |
|password|string|*Only if username is specified*|Configured password for basic authentication.   Cumulus encrypts this using KMS and uses it in a `Basic` auth header if needed for authentication |
|port|integer|No|Port to connect to the provider on.   Defaults to `443` |

### ftp

|Key  |Type |Required|Description|
|:---:|:----|:------:|-----------|
|id|string|Yes|Unique identifier for the provider|
|globalConnectionLimit|integer|No|Integer specifying the connection limit for the provider.  This is the maximum number of connections Cumulus compatible ingest lambdas are expected to make to a provider.  Defaults to unlimited |
|protocol|string|Yes|The protocol for this provider.  Must be `ftp` for this provider type |
|host|string|Yes|The ftp host to pull data from (e.g. `nasa.gov`) |
|username|string|No|Username to use to connect to the ftp server.  Cumulus encrypts this using KMS. Defaults to `anonymous` if not defined |
|password|string|No|Password to use to connect to the ftp server.  Cumulus encrypts this using KMS. Defaults to `password` if not defined |
|port|integer|No|Port to connect to the provider on.  Defaults to `21`

### sftp

|Key  |Type |Required|Description|
|:---:|:----|:------:|-----------|
|id|string|Yes|Unique identifier for the provider|
|globalConnectionLimit|integer|No|Integer specifying the connection limit for the provider.  This is the maximum number of connections Cumulus compatible ingest lambdas are expected to make to a provider.  Defaults to unlimited |
|protocol|string|Yes|The protocol for this provider.  Must be `sftp` for this provider type |
|host|string|Yes|The ftp host to pull data from (e.g. `nasa.gov`) |
|username|string|No|Username to use to connect to the sftp server.|
|password|string|No|Password to use to connect to the sftp server. |
|port|integer|No|Port to connect to the provider on.  Defaults to `22`
