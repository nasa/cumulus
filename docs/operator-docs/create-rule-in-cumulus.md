---
id: create-rule-in-cumulus
title: Create Rule In Cumulus
hide_title: true
---

# Create Rule In Cumulus

Once the above files are in place and the entries created in CMR and Cumulus, we are ready to begin ingesting data. Depending on the type of ingestion (FTP/Kinesis, etc) the values below will change, but for the most part they are all similar. Rules tell Cumulus how to associate providers and collections, and when/how to start processing a workflow.

1. Go To Rules Page

* Go to the Cumulus dashboard, click on `Rules` in the navigation
* Click `Add Rule`

2. Complete Form

* Fill out the template form
  * Name. Create a descriptive, unique name.
  * Workflow name maps to one of the workflows defined in the deployment. They can be listed from the dashboard under the 'Workflows' page. This is either DiscoverGranules (FTP) or IngestKinesis (kinesis ingest).
  * Provider ID: The provider that you have created or selected from.
  * Collection Name / Collection version: Must map to what was created above.
  * Ruletype
    * One time: Run this rule exactly once. One time ruletypes are run regardless of state.
    * scheduled: Run on a cron like schedule (every 3 hours, every day at midnight, etc).
    * sns: not used.
    * kinesis:start workflows from a kinesis stream.
  * Rule value
    * One time: Leave blank.
    * schedule: The rate/cron entry. See (<https://docs.aws.amazon.com/lambda/latest/dg/tutorial-scheduled-events-schedule-expressions.html)> for details, but you can add something like `rate(4 hours)` to run every 4 hours.
    * sns: Not used (ostensibly, the TOPIC arn number).
    * kinesis: The arn value of the kinesis stream that will trigger ingestion.
  * State
    * Enabled: Runs when the action is triggered (schedule, kinesis, etc).
    * Disabled: Does not run.

> **Note:** If the state field is left blank, it defaults to `false`.
