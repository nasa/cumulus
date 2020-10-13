---
id: version-v3.0.0-create-cumulus-data-mgmt-types
title: Creating Cumulus Data Management Types
hide_title: false
original_id: create-cumulus-data-mgmt-types
---

## What Is A Cumulus Data Management Type

* `Collections`: Collections are logical sets of data objects of the same data type and version. They provide contextual information used by Cumulus ingest.
* `Granules`: Granules are the smallest aggregation of data that can be independently managed. They are always associated with a collection, which is a grouping of granules.
* `Providers`: Providers generate and distribute input data that Cumulus obtains and sends to workflows.
* `Rules`: Rules tell Cumulus how to associate providers and collections and when/how to start processing a workflow.
* `Workflows`: Workflows are composed of one or more AWS Lambda Functions and ECS Activities to discover, ingest, process, manage, and archive data.
* `Executions`: Executions are records of a workflow.
* `Reconciliation Reports`: Reports are a comparison of data sets to check to see if they are in agreement and to help Cumulus users detect conflicts.

### Create A Provider

* In the Cumulus dashboard, go to the `Provider` page.

![Screenshot of Create Provider form](assets/cd_provider_page.png)

* Click on `Add Provider`.
* Fill in the form and then submit it.

![Screenshot of Create Provider form](assets/cd_add_provider_form.png)

### Create A Collection

* Go to the `Collections` page.

![Screenshot of the Collections page](assets/cd_collections_page.png)

* Click on `Add Collection`.
* Copy and paste or fill in the collection JSON object form.

![Screenshot of Add Collection form](assets/cd_add_collection.png)

* Once you submit the form, you should be able to verify that your new collection is in the list.

### Create A Rule

Refer to [Create Rule In Cumulus](../operator-docs/create-rule-in-cumulus).

### Create A Workflow

For details on setting up a workflow go to [Cumulus Workflows](../workflows).
