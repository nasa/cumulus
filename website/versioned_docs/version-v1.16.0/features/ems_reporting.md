---
id: version-v1.16.0-ems_reporting
title: EMS Reporting
hide_title: true
original_id: ems_reporting
---

# EMS Reporting

Cumulus reports usage statistics to the [ESDIS Metrics System (EMS)](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/esdis-metrics-system-ems).

## Collection Configuration

By default, a collection and its related records (Ingest, Distribution etc.) will be reported to EMS if the collection exists in both Cumulus and CMR.  We can also configure to not report a collection to EMS by setting the collection configuration parameter `reportToEms` set to `false`.  If the collection has been reported to EMS, it can only be removed manually by the EMS team.

## Types of Reports

### Product Metadata

Cumulus creates a nightly Product Metadata report.  The Product Metadata report provides ancillary information about the products (collections) in Cumulus, and this information is required before EMS can process ingest and distribution reports.

### Ingest

Cumulus creates three ingest related reports for EMS: Ingest, Archive and Archive Delete.

The Ingest report contains records of all granules that have been ingested into Cumulus.

The Archive report contains records of all granules that have been archived into Cumulus.  It's similar to Ingest report.

The Archive Delete report lists granules that were reported to the EMS and now have been deleted from Cumulus.

A scheduled Lambda task will run nightly that generates Ingest, Archive and Archive Delete reports.

### Distribution

Cumulus reports all data distribution requests that pass through the distribution API to EMS. In order to track these requests, S3 server access logging must be enabled on all protected buckets.

You must manually enable logging for each bucket before distribution logging will work, see [S3 Server Access Logging.](../deployment/server_access_logging)

A scheduled Lambda task will run nightly that collects distribution events and builds an EMS distribution report.

## Report Submission

Information about requesting EMS account can be found on EMS website.  Here are basic steps in order to submit reports to EMS.

### 1) Get a provider account on the EMS file server and obtain access to their UAT or OPS environment

Provide IP addresses, data provider name , contact information (primary and secondary) to EMS, and EMS will set up account and firewall rules to allow applications to send files to EMS.
For Cumulus instances running on NGAP, the IP address should be the Elastic IP (IPv4 Public IP field) of the `NGAP NAT Instance` in EC2, and that should be the IP that EMS firewall sees for any instance in that account.

### 2) Request updates on NGAP NACL

For Cumulus instances running on NGAP, submit a [NGAP service desk ticket](https://bugs.earthdata.nasa.gov/servicedesk/customer/portals), and specify "Exception / Enhancement” request for “Network / Whitelist” changes to the account, that will add EMS host IP to the NACL (Network Access Control List) to allow outbound traffic from NGAP Application VPCs to EMS host.

### 3) Send public key to EMS. Lambda will provide private key when sftp files to EMS

Upload the corresponding private key to s3, use `system_bucket` as bucket name and `{prefix}/crypto/ems-private.pem` as key,  `system_bucket` and `prefix` are configured in your deployment's `terraform.tfvars` file.  If a different private key file name other than `ems-private.pem` is used, specify it in the `ems_private_key` configuration in `terraform.tfvars`.

### 4) Create a data manifest file manually and send it to EMS team, and EMS team will configure the data provider on their side.  _Example configuration of the data manifest file can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/data/ems)_

### 5) Create a data collection to send to EMS.  The report will be automatically generated and submit to EMS, and this step will be deleted after [CUMULUS-1273](https://bugs.earthdata.nasa.gov/browse/CUMULUS-1273) is completed

### 6) Configure the `ems*` configuration variables passed to the `cumulus` terraform module. _Example configuration of the `ems*` variables can be found in Cumulus core's [example](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/terraform.tfvars.example)_

If  `ems_submit_report` is not set to `true` in the configuration, the reports are still generated in `s3://{buckets.internal.name}/{prefix}/ems/{filename}` for Product Metadata and Ingest reports, and `s3://{buckets.internal.name}/{prefix}/ems-distribution/reports/{filename}` for Distribution reports, but they won't be submitted to EMS.

Submitted reports will be saved to `sent` folder.

## Report Status

1. EMS processes the reports and generates error reports which it sends to the provider's point of contacts.
2. APEX EMS Reporting system allows users access to ingest, archive, distribution, and error metrics.  The user with 'power user' privilege can also view the `Data Provider Status` and the status of flat files.

The operator can submit an IdMAX request in [NASA Access Management System (NAMS)](https://idmax.nasa.gov/nams) to get access to `GSFC ESDIS Metric System (EMS)`.
