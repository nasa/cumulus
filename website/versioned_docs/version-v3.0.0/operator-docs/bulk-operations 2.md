---
id: version-v3.0.0-bulk-operations
title: Bulk Operations
hide_title: false
original_id: bulk-operations
---

Cumulus implements bulk operations through the use of `AsyncOperations`, which are long-running processes executed on an AWS ECS cluster.

## Submitting a bulk API request

Bulk operations are generally submitted via the endpoint for the relevant data type, e.g. granules. For a list of supported API requests, refer to the [Cumulus API documentation](https://nasa.github.io/cumulus-api/#bulk-operations). Bulk operations are denoted with the keyword 'bulk'.

## Starting bulk operations from the Cumulus dashboard

### Using a Kibana query

> Note: You **[must have configured your dashboard build with a KIBANAROOT environment variable](https://github.com/nasa/cumulus-dashboard#configuration)** in order for the Kibana link to render in the bulk granules modal

1. From the Granules dashboard page, click on the "Run Bulk Granules" button, then select what type of action you would like to perform
    - Note: the rest of the process is the same regardless of what type of bulk action you perform
2. From the bulk granules modal, click the "Open Kibana" link:

    ![Screenshot of Cumulus dashboard showing modal window for triggering bulk granule operations](assets/bulk-granules-modal.png)

3. Once you have accessed Kibana, navigate to the "Discover" page. If this is your first time using Kibana, you may see a message like this at the top of the page:

    `In order to visualize and explore data in Kibana, you'll need to create an index pattern to retrieve data from Elasticsearch.`

    In that case, see the docs for [creating an index pattern for Kibana](#creating-an-index-pattern-for-kibana)

    ![Screenshot of Kibana user interface showing the "Discover" page for running queries](assets/kibana-discover-page.png)

4. Enter a query that returns the granule records that you want to use for bulk operations:

    ![Screenshot of Kibana user interface showing an example Kibana query and results](assets/kibana-discover-query.png)

5. Once the Kibana query is returning the results you want, click the "Inspect" link near the top of the page. A slide out tab with request details will appear on the right side of the page:

    ![Screenshot of Kibana user interface showing details of an example request](assets/kibana-inspect-request.png)

6. In the slide out tab that appears on the right side of the page, click the "Request" link near the top and scroll down until you see the `query` property:

    ![Screenshot of Kibana user interface showing the Elasticsearch data request made for a given Kibana query](assets/kibana-inspect-query.png)

7. Highlight and copy the `query` contents from Kibana. Go back to the Cumulus dashboard and paste the `query` contents from Kibana **inside of the `query` property in the bulk granules request payload**. **It is expected** that you should have a property of `query` nested inside of the existing `query` property:

    ![Screenshot of Cumulus dashboard showing modal window for triggering bulk granule operations with query information populated](assets/bulk-granules-query-1.png)

8. Add values for the `index` and `workflowName` to the bulk granules request payload. The value for `index` will vary based on your Elasticsearch setup, but it is good to target an index specifically for granule data if possible:

    ![Screenshot of Cumulus dashboard showing modal window for triggering bulk granule operations with query, index, and workflow information populated](assets/bulk-granules-query-2.png)

9. Click the "Run Bulk Operations" button. You should see a confirmation message, including an ID for the async operation that was started to handle your bulk action. You can [track the status of this async operation on the Operations dashboard page](#status-tracking), which can be visited by clicking the "Go To Operations" button:

    ![Screenshot of Cumulus dashboard showing confirmation message with async operation ID for bulk granules request](assets/bulk-granules-submitted.png)

#### Creating an index pattern for Kibana

1. Define the index pattern for the indices that your Kibana queries should use. A wildcard character, `*`, will match across multiple indices. Once you are satisfied with your index pattern, click the "Next step" button:

    ![Screenshot of Kibana user interface for defining an index pattern](assets/kibana-create-index-pattern-1.png)

2. Choose whether to use a Time Filter for your data, which is not required. Then click the "Create index pattern" button:

    ![Screenshot of Kibana user interface for configuring the settings of an index pattern](assets/kibana-create-index-pattern-2.png)

## Status Tracking

All bulk operations return an `AsyncOperationId` which can be submitted to the `/asyncOperations` endpoint.

The `/asyncOperations` endpoint allows listing of AsyncOperation records as well as record retrieval for individual records, which will contain the status.
The [Cumulus API documentation](https://nasa.github.io/cumulus-api/#list-async-operations) shows sample requests for these actions.

The Cumulus Dashboard also includes an Operations monitoring page, where operations and their status are visible:

![Screenshot of Cumulus Dashboard Operations Page showing 5 operations and their status, ID, description, type and creation timestamp](assets/cd_operations_page.png)
