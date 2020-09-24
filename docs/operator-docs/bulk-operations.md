---
id: bulk-operations
title: Bulk Operations
hide_title: true
---

# Bulk Operations

Cumulus implements bulk operations through the use of `AsyncOperations`, which are long-running processes executed on an AWS ECS cluster.

## Submitting a bulk API request

Bulk operations are generally submitted via the endpoint for the relevant data type, e.g. granules. For a list of supported API requests, refer to the [Cumulus API documentation](https://nasa.github.io/cumulus-api/#bulk-operations). Bulk operations are denoted with the keyword 'bulk'.

## Starting bulk operations from the dashboard

### Using a Kibana query

> Note: You must have configured your dashboard build with a KIBANAROOT environment variable pointing to Cloud Metrics Kibana URL for your environment in order for the Kibana link to render

1. Click the "Open Kibana" link
2. Navigate to the "Discover" page and enter a query that returns the granule records that you want to use for bulk operations

    ![Screenshot of Kibana query interface showing an example query and results](assets/kibana-discover-query.png)

3. Once the Kibana query is returning the results you want, click the "Inspect" and then click the "Request" tab in the slide out bar

  ![Screenshot of Kibana interface showing the interface to inspect an example data request](assets/kibana-inspect-query.png)

## Status Tracking

All bulk operations return an `AsyncOperationId` which can be submitted to the `/asyncOperations` endpoint.

The `/asyncOperations` endpoint allows listing of AsyncOperation records as well as record retrieval for individual records, which will contain the status.
The [Cumulus API documentation](https://nasa.github.io/cumulus-api/#list-async-operations) shows sample requests for these actions.

The Cumulus Dashboard also includes an Operations monitoring page, where operations and their status are visible:

![Screenshot of Cumulus Dashboard Operations Page](assets/cd_operations_page.png)
