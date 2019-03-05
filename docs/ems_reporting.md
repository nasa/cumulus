---
id: ems_reporting
title: EMS Reporting
hide_title: true
---

# EMS Reporting
Cumulus reports usage statistics to the [ESDIS Metrics System (EMS)](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/esdis-metrics-system-ems).
Two types of reports are generated: ingest and distribution.

## Ingest

Cumulus creates three ingest related reports for EMS: Ingest, Archive and Archive Delete.

The Ingest report contains records of all granules, products, or files that have been ingested into Cumulus.

The Archive report contains records of all granules, products, or files that have been archived into Cumulus.  It's similar to Ingest report.

The Archive Delete report lists granules, products, or files that were reported to the EMS and now have been deleted from Cumulus.

A scheduled Lambda task will run nightly that generates Ingest, Archive and Archive Delete reports.

## Distribution

Cumulus reports all data distribution requests that pass through the
distribution API to EMS. In order to track these requests, S3 Server Access
Logging must be enabled on all protected buckets.

You will need to enable logging for each bucket manually before distribution
logging will work.

[How Do I Enable Server Access Logging for an S3 Bucket?](https://docs.aws.amazon.com/AmazonS3/latest/user-guide/server-access-logging.html)

When enabling server access logging, the "Target bucket" should be set to your
stack's internal bucket. The "Target prefix" should be set to
"<STACK_NAME>/ems-distribution/s3-server-access-logs/" (include trailing slash),
where "<STACK_NAME>" is replaced with the name of your Cumulus stack.

A scheduled Lambda task will run nightly that collects distribution events and
builds an EMS distribution report.
