---
id: granule-workflows
title: Granule Workflows
hide_title: true
---

## Granule Workflows

### Ingest Kinesis

1. Generate AWS Long Term Access Key

* For steps on creating an AWS Access Key go to [AWS Long Term Access Key](../operator-docs/aws-long-term-access-key).
* Copy the AWS Long Term Access Key.

2. Add a Collection

* Open another tab in your browser and go to your Earthdata Git repository URL or where your collection data files are located.
* Open the collection configuration .json file that you will copy to the Cumulus dashboard.
* In the Cumulus dashboard, add a new collection with an attached rule.
  - Go to the 'Collections' page and then click on `Add Collection`.
  ![Screenshot of Collections Page](assets/cd_collections_page.png)
  - Cut and paste the collection in the template between the `{}` lines.
  ![Screenshot of a Collection template for adding a new collection](assets/cd_collection.png)
  - Click `Save` to create the new collection.
  - Go to the 'Rules' page and then click on `Add Rule`.
  ![Screenshot of Rules page](assets/cd_rules_page.png)
  - Fill out the template form.
  ![Screenshot of a Rules template for adding a new rule](assets/cd_add_rule.png)
  - Click `Save` to create the new rule.


3. Bulk Ingest Granules
* Go to the 'Granules' page
* Click on `Run Bulk Granules` and a modal will pop up. Select `Run Bulk Operations` button on the right.
![Screenshot of Run Bulk Granules](assets/cd_run_bulk_modal.png)
* Complete the form
![Screenshot of Run Bulk Operations template](assets/cd_run_bulk_granules.png)
* Go to the 'Executions' page to view the status of the ingested granules.
![Screenshot of Executions Page](assets/cd_executions_page.png)



### Failed Granule

1. Delete from CMR

2. Re-ingest Granule

### Multiple Failed Granules

1. Go to Granules Page

* In the Cumulus dashboard, go to the Granules page
* Click on "Failed Granules"

2. Bulk Re-ingest Granules