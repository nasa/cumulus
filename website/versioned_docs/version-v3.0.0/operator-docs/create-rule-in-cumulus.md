---
id: version-v3.0.0-create-rule-in-cumulus
title: Create Rule In Cumulus
hide_title: false
original_id: create-rule-in-cumulus
---

Once the above files are in place and the entries created in CMR and Cumulus, we are ready to begin ingesting data. Depending on the type of ingestion (FTP/Kinesis, etc) the values below will change, but for the most part they are all similar. Rules tell Cumulus how to associate providers and collections, and when/how to start processing a workflow.

## Steps
<!-- markdownlint-disable MD029 -->
1. Go To Rules Page

* Go to the Cumulus dashboard, click on `Rules` in the navigation.
* Click `Add Rule`.

![Screenshot of Rules page](assets/cd_rules_page.png)

2. Complete Form
<!-- markdownlint-enable MD029 -->

* Fill out the template form.

![Screenshot of a Rules template for adding a new rule](assets/cd_add_rule_form_blank.png)

For more details regarding the field definitions and required information go to [Data Cookbooks](https://nasa.github.io/cumulus/docs/data-cookbooks/setup#rules).

> **Note:** If the state field is left blank, it defaults to `false`.

## Examples

* A rule form with completed required fields:

![Screenshot of a completed rule form](assets/cd_add_rule_filled.png)

* A successfully added Rule:

![Screenshot of created rule](assets/cd_add_rule_overview.png)
