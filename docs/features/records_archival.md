---
id: records_archival
title: Records Archival
hide_title: false
---

In pursuit of more a more performant dashboard and other queries to the database, we're enabling old executions and granules to be flagged as "archived" meaning that they will be hidden by default in the dashboard, and queries can be constructed to performantly exclude them.

## Archival Cron

There is a new task lambda which is run on a schedule, and archives a batch of granules and executions older than a certain age. This will run asynchronously in the background of ingest and at a cadence to keep up with ingest. Slower, more conservative cadence will still be functional, but will fail over time to keep up with archiving *all* old records.

### Configuration

Configuration for those values is set in the archive tf-module, and is structured as follows:

#### daily_archive_records_schedule_expression __(string)__

cron schedule for running the task, using a Cloudwatch cron expression.

Default Value is `"cron(0 4 * * ? *)"`

#### archive_batch_size __(number)__

How many executions and granules to archive in one run of the task function.  This will archive up to <archive_batch_size> granules *and* up to <archive_batch_size> executions

Default value is 10000.

#### archive_expiration-days __(number)__

how old a record should be in days before it is archived.

default value is 365
