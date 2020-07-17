---
id: granule-workflows
title: Granule Workflows
hide_title: true
---

# Granule Workflows

## Ingest Kinesis

### Setup for Ingest

1. Copy your AWS Long Term Access Key.
<!-- markdownlint-disable MD029 -->

2. Add a Collection

* Open another tab in your browser and go to your Earthdata Git repository URL or where your collection data files are located. If you do not have collection data stored, you can manually configure your collections as well.

> **Tip**: A list of collection config params can be accessed [here](https://nasa.github.io/cumulus/docs/data-cookbooks/setup#collections)

* Open the collection configuration .json file that you will copy to the Cumulus dashboard.
* In the Cumulus dashboard, add a new collection with an attached rule.
* Go to the `Collections` page and then click on `Add Collection`.

  ![Screenshot of Collections Page](assets/cd_collections_page.png)

  * Cut and paste the collection in the template between the `{}` lines.

  ![Screenshot of a Collection template filled in](assets/cd_add_collection_filled.png)

  * Click `Save` to create the new collection.

  ![Screenshot of a Collection template for adding a new collection](assets/cd_add_collection_overview.png)
  
* Go to the `Rules` page and then click on `Add Rule`.

  ![Screenshot of Rules page](assets/cd_rules_page.png)

  * Fill out the template form. If you need details on the fields and how to complete a rule form go to [Create Rule In Cumulus](../operator-docs/create-rule-in-cumulus)

  ![Screenshot of a Rules template for adding a new rule](assets/cd_add_rule_form_blank.png)

  * Click `Save` to create the new rule.

  ![Screenshot of created rule](assets/cd_add_rule_overview.png)

* Now your setup is ready to ingest via Kinesis. Go here to see how to run a [Kinesis Stream For Ingest](../operator-docs/kinesis-stream-for-ingest).

3. Bulk Ingest Granules

* Go to the 'Collections' page

  * Click on `Run Bulk Granules` and a modal will pop up. Select `Run Bulk Operations` button on the right.

  ![Screenshot of Run Bulk Granules](assets/cd_run_bulk_modal.png)

  * Complete the form

  ![Screenshot of Run Bulk Operations template](assets/cd_run_bulk_granules.png)

* Go to the 'Executions' page to view the status of the ingested granules.

  ![Screenshot of Executions Page](assets/cd_executions_page.png)

## Failed Granule

1. Delete from CMR 
> **Note**: Each location or DAAC has different procedures for deleting a granule from CMR.

2. Select Failed Granule

* In the Cumulus dashboard, go to the `Collections` page.
* Use search field to find the granule.

3. Re-ingest Granule

* Go to the `Collections` page.
* Click on `Reingest` and a modal will pop up for your confirmation.

![Screenshot of the Reingest modal workflow](assets/cd_reingest_granule_modal.png)

## Multiple Failed Granules

1. Delete from CMR
> **Note**: Each location or DAAC has different procedures for deleting multiple granules from CMR.

2. Select Failed Granules

* In the Cumulus dashboard, go to the `Collections` page.
* Click on `Failed Granules`.
* Select multiple granules.

![Screenshot of selected multiple granules](assets/cd_reingest_bulk.png)

3. Bulk Re-ingest Granules

* Click on `Reingest` and a modal will pop up for your confirmation.

![Screenshot of Bulk Reingest modal workflow](assets/cd_reingest_modal_bulk.png)
<!-- markdownlint-enable MD029 -->