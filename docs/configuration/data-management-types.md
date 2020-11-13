---
id: data-management-types
title: Cumulus Data Management Types
hide_title: false
---

## What Are The Cumulus Data Management Types

- `Collections`: Collections are logical sets of data objects of the same data type and version. They provide contextual information used by Cumulus ingest.
- `Granules`: Granules are the smallest aggregation of data that can be independently managed. They are always associated with a collection, which is a grouping of granules.
- `Providers`: Providers generate and distribute input data that Cumulus obtains and sends to workflows.
- `Rules`: Rules tell Cumulus how to associate providers and collections and when/how to start processing a workflow.
- `Workflows`: Workflows are composed of one or more AWS Lambda Functions and ECS Activities to discover, ingest, process, manage, and archive data.
- `Executions`: Executions are records of a workflow.
- `Reconciliation Reports`: Reports are a comparison of data sets to check to see if they are in agreement and to help Cumulus users detect conflicts.

## Interaction

- **Providers** tell Cumulus where to get new data - i.e. S3, HTTPS
- **Collections** tell Cumulus where to store the data files
- **Rules** tell Cumulus when to trigger a workflow execution and tie providers and collections together

## Managing Data Management Types

The following are created via the dashboard or API:

- **Providers**
- **Collections**
- **Rules**
- **Reconciliation reports**

**Granules** are created by workflow executions and then can be managed via the dashboard or API.

 An **execution** record is created for each workflow execution triggered and can be viewed in the dashboard or data can be retrieved via the API.

**Workflows** are created and managed via the Cumulus deployment.

## Configuration Fields

See [data cookbooks introduction](../data-cookbooks/setup).

## Configuration Via Cumulus Dashboard

### Create A Provider

- In the Cumulus dashboard, go to the `Provider` page.

![Screenshot of Create Provider form](assets/cd_provider_page.png)

- Click on `Add Provider`.
- Fill in the form and then submit it.

![Screenshot of Create Provider form](assets/cd_add_provider_form.png)

### Create A Collection

- Go to the `Collections` page.

![Screenshot of the Collections page](assets/cd_collections_page.png)

- Click on `Add Collection`.
- Copy and paste or fill in the collection JSON object form.

![Screenshot of Add Collection form](assets/cd_add_collection.png)

- Once you submit the form, you should be able to verify that your new collection is in the list.

### Create A Rule

1. Go To Rules Page
<!-- markdownlint-disable MD029 -->

- Go to the Cumulus dashboard, click on `Rules` in the navigation.
- Click `Add Rule`.

![Screenshot of Rules page](assets/cd_rules_page.png)

2. Complete Form

- Fill out the template form.

<!-- markdownlint-enable MD029 -->
![Screenshot of a Rules template for adding a new rule](assets/cd_add_rule_form_blank.png)

For more details regarding the field definitions and required information go to [Data Cookbooks](https://nasa.github.io/cumulus/docs/data-cookbooks/setup#rules).

> **Note:** If the state field is left blank, it defaults to `false`.

#### Rule Examples

- A rule form with completed required fields:

![Screenshot of a completed rule form](assets/cd_add_rule_filled.png)

- A successfully added Rule:

![Screenshot of created rule](assets/cd_add_rule_overview.png)
