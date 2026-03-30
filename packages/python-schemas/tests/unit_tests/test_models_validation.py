from python_schemas.models.cnm import Cnm


def test_cnm_s():
    Cnm.model_validate(
        {
            "product": {
                "files": [
                    {
                        "checksumType": "md5",
                        "checksum": "00000000000000000000000000000000",
                        "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "type": "data",
                        "size": 18795152,
                    },
                    {
                        "checksumType": "md5",
                        "checksum": "00000000000000000000000000000000",
                        "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                        "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                        "type": "metadata",
                        "size": 32,
                    },
                ],
                "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                "dataVersion": "1.0",
            },
            "receivedTime": "2020-04-08T16:00:16.958Z",
            "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
            "version": "1.1",
            "provider": "NASA/JPL/PO.DAAC",
            "submissionTime": "2020-04-08T15:59:15.187Z",
            "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        }
    )


def test_cnm_s_alpha_version():
    Cnm.model_validate(
        {
            "product": {
                "files": [
                    {
                        "checksumType": "md5",
                        "checksum": "00000000000000000000000000000000",
                        "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "type": "data",
                        "size": 18795152,
                    },
                    {
                        "checksumType": "md5",
                        "checksum": "00000000000000000000000000000000",
                        "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                        "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                        "type": "metadata",
                        "size": 32,
                    },
                ],
                "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                "dataVersion": "1.0",
            },
            "receivedTime": "2020-04-08T16:00:16.958Z",
            "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
            "version": "1.6.1-alpha.0",
            "provider": "NASA/JPL/PO.DAAC",
            "submissionTime": "2020-04-08T15:59:15.187Z",
            "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        }
    )


def test_cnm_r():
    Cnm.model_validate(
        {
            "product": {
                "files": [
                    {
                        "checksumType": "md5",
                        "checksum": "3b6de83e361a01867a9e541a4bf771dc",
                        "uri": "https://unit.test-example.com/dev/test-protected/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                        "type": "data",
                        "size": 18795152,
                    },
                    {
                        "checksumType": "md5",
                        "checksum": "11236de83e361eesss332f771dc",
                        "uri": "https://unit.test-example.com/dev/test-public/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                        "name": (
                            "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json"
                        ),
                        "type": "metadata",
                        "size": 1236,
                    },
                ],
                "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2",
                "dataVersion": "1.0",
            },
            "receivedTime": "2020-04-08T16:00:16.958Z",
            "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
            "version": "1.1",
            "provider": "NASA/JPL/PO.DAAC",
            "submissionTime": "2020-04-08T15:59:15.187Z",
            "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
            "response": {
                "status": "SUCCESS",
            },
            "ingestionMetadata": {
                "catalogId": "G1234313662-POCUMULUS",
                "catalogUrl": "https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=G1234313662-POCUMULUS",
            },
            "processCompleteTime": "2026-01-01 20:50:35Z",
        }
    )
