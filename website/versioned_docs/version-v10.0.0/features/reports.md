---
id: reports
title: Reconciliation Reports
hide_title: false
---

## Report Types

### Inventory Reports

Inventory reports provide a detailed report of collections, granules and files in Cumulus and CMR.
This report shows the following data:

* Granule files in Cumulus, those that are in S3[^note] but missing in the internal data store and those in the internal data store but not S3
* All Collections in Cumulus and CMR, highlighting any collections only in Cumulus or only in CMR
* All Granules in Cumulus and CMR belonging to collections found in both, highlighting any granules only in Cumulus or only in CMR
* All granule files in Cumulus and CMR belonging to granules found in both, highlighting any files only in Cumulus or only in CMR

### Granule Not Found Reports

* Granule Not Found reports provide a fixed view on missing granules, comparing them across S3, Cumulus, and CMR.
* For an individual granule, it will display whether it is okay (green), missing some data (yellow),
  or missing all data (red) for each of S3, Cumulus, and CMR

## Viewing Reports on the Cumulus Dashboard

The Cumulus Dashboard offers an interface to create, manage and view these inventory reports.

The Reconciliation Reports Overview page shows a full list of existing reports and the option to create a new report.
![Screenshot of the Dashboard Reconciliation Reports Overview page](../assets/rec_reports_overview.png)

Viewing an inventory report will show a detailed list of collections, granules and files.
![Screenshot of an Inventory Report page](../assets/inventory_report.png)

Viewing a granule not found report will show a list of granules missing data
![Screenshot of a Granule Not Found Report page](../assets/granule_not_found_report.png)

## API

The API also allows users to create and view reports. For more extensive API documentation, see the [Cumulus API docs](https://nasa.github.io/cumulus-api/#list-reconciliation-reports).

### Creating a Report via API

Create a new inventory report with the following:

```bash
curl --request POST https://example.com/reconciliationReports --header 'Authorization: Bearer ReplaceWithToken'
```

Example response:

```json
{
    "message": "Report is being generated",
    "status": 202
}
```

### Retrieving a Report via API

Once a report has been generated, you can retrieve the full report.

```bash
curl https://example.com/reconciliationReports/inventoryReport-20190305T153430508 --header 'Authorization: Bearer ReplaceWithTheToken'
```

Example response:

```json
{
    "reportStartTime": "2019-03-05T15:34:30.508Z",
    "reportEndTime": "2019-03-05T15:34:37.243Z",
    "status": "SUCCESS",
    "error": null,
    "filesInCumulus": {
        "okCount": 40,
        "onlyInS3": [
            "s3://cumulus-test-sandbox-protected/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml",
            "s3://cumulus-test-sandbox-private/BROWSE.MYD13Q1.A2017297.h19v10.006.2017313221201.hdf"
        ],
        "onlyInDynamoDb": [
            {
                "uri": "s3://cumulus-test-sandbox-protected/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
                "granuleId": "MOD09GQ.A2016358.h13v04.006.2016360104606"
            }
        ]
    },
    "collectionsInCumulusCmr": {
        "okCount": 1,
        "onlyInCumulus": [
            "L2_HR_PIXC___000"
        ],
        "onlyInCmr": [
            "MCD43A1___006",
            "MOD14A1___006"
        ]
    },
    "granulesInCumulusCmr": {
        "okCount": 3,
        "onlyInCumulus": [
            {
                "granuleId": "MOD09GQ.A3518809.ln_rVr.006.7962927138074",
                "collectionId": "MOD09GQ___006"
            },
            {
                "granuleId": "MOD09GQ.A8768252.HC4ddD.006.2077696236118",
                "collectionId": "MOD09GQ___006"
            }
        ],
        "onlyInCmr": [
            {
                "GranuleUR": "MOD09GQ.A0002421.oD4zvB.006.4281362831355",
                "ShortName": "MOD09GQ",
                "Version": "006"
            }
        ]
    },
    "filesInCumulusCmr": {
        "okCount": 11,
        "onlyInCumulus": [
            {
                "fileName": "MOD09GQ.A8722843.GTk5A3.006.4026909316904.jpeg",
                "uri": "s3://cumulus-test-sandbox-public/MOD09GQ___006/MOD/MOD09GQ.A8722843.GTk5A3.006.4026909316904.jpeg",
                "granuleId": "MOD09GQ.A8722843.GTk5A3.006.4026909316904"
            }
        ],
        "onlyInCmr": [
            {
                "URL": "https://cumulus-test-sandbox-public.s3.amazonaws.com/MOD09GQ___006/MOD/MOD09GQ.A8722843.GTk5A3.006.4026909316904_ndvi.jpg",
                "Type": "GET DATA",
                "GranuleUR": "MOD09GQ.A8722843.GTk5A3.006.4026909316904"
            }
        ]
    }
}
```

[^note]: Reconciliation reports only search data buckets for objects during the
    report generation.  The data buckets will include any buckets in your
    Cumulus buckets configuration that have type `public`, `protected` or
    `private`.
