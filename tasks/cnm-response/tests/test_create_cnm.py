import json

from cnm_response.create_cnm import CnmGenerator, HttpUriGenerator
from freezegun import freeze_time


@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_error(cnm_s, granule):
    gen = CnmGenerator()

    assert gen.get_cnm_r(
        cnm_s=cnm_s,
        exception=json.dumps(
            {"Cause": "A simple string", "Error": "An unclassified error"}
        ),
        granule=granule,
    ) == {
        "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        "processCompleteTime": "2026-01-01 20:50:35Z",
        "provider": "NASA/JPL/PO.DAAC",
        "receivedTime": "2020-04-08T16:00:16.958Z",
        "response": {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": "A simple string",
        },
        "submissionTime": "2020-04-08 15:59:15.186779",
        "version": "1.1",
    }


@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_error_cause(cnm_s, granule):
    gen = CnmGenerator()

    assert gen.get_cnm_r(
        cnm_s=cnm_s,
        exception=json.dumps(
            {
                "Cause": '{"errorMessage": "message from cause"}',
                "Error": "An unclassified error",
            }
        ),
        granule=granule,
    ) == {
        "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        "processCompleteTime": "2026-01-01 20:50:35Z",
        "provider": "NASA/JPL/PO.DAAC",
        "receivedTime": "2020-04-08T16:00:16.958Z",
        "response": {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": "message from cause",
        },
        "submissionTime": "2020-04-08 15:59:15.186779",
        "version": "1.1",
    }


@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_error_transfer_error(cnm_s, granule):
    gen = CnmGenerator()

    for error_type in ("FileNotFound", "ConnectionTimeout", "RemoteResourceError"):
        assert gen.get_cnm_r(
            cnm_s=cnm_s,
            exception=json.dumps(
                {
                    "Cause": '{"errorMessage": "message from cause"}',
                    "Error": error_type,
                }
            ),
            granule=granule,
        ) == {
            "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
            "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
            "processCompleteTime": "2026-01-01 20:50:35Z",
            "provider": "NASA/JPL/PO.DAAC",
            "receivedTime": "2020-04-08T16:00:16.958Z",
            "response": {
                "status": "FAILURE",
                "errorCode": "TRANSFER_ERROR",
                "errorMessage": "message from cause",
            },
            "submissionTime": "2020-04-08 15:59:15.186779",
            "version": "1.1",
        }


@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_error_validation_error(cnm_s, granule):
    gen = CnmGenerator()

    for error_type in ("InvalidChecksum", "UnexpectedFileSize"):
        assert gen.get_cnm_r(
            cnm_s=cnm_s,
            exception=json.dumps(
                {
                    "Cause": '{"errorMessage": "message from cause"}',
                    "Error": "InvalidChecksum",
                }
            ),
            granule=granule,
        ) == {
            "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
            "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
            "processCompleteTime": "2026-01-01 20:50:35Z",
            "provider": "NASA/JPL/PO.DAAC",
            "receivedTime": "2020-04-08T16:00:16.958Z",
            "response": {
                "status": "FAILURE",
                "errorCode": "VALIDATION_ERROR",
                "errorMessage": "message from cause",
            },
            "submissionTime": "2020-04-08 15:59:15.186779",
            "version": "1.1",
        }


@freeze_time("2026-01-01 20:50:35Z")
def test_get_default_cnm_r_error(cnm_s):
    gen = CnmGenerator()

    assert gen.get_default_cnm_r_error(cnm_s=cnm_s, cause="message from cause") == {
        "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        "processCompleteTime": "2026-01-01 20:50:35Z",
        "provider": "NASA/JPL/PO.DAAC",
        "receivedTime": "2020-04-08T16:00:16.958Z",
        "response": {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": "message from cause",
        },
        "submissionTime": "2020-04-08 15:59:15.186779",
        "version": "1.1",
    }


def test_http_uri_generator():
    assert (
        HttpUriGenerator(
            distribution_endpoint="http://distribution-uri:9000/DEV"
        ).get_uri({"bucket": "protected-bucket", "key": "granule_id.nc"})
        == "http://distribution-uri:9000/DEV/protected-bucket/granule_id.nc"
    )
    assert (
        HttpUriGenerator(
            distribution_endpoint="http://distribution-uri:9000/DEV/"
        ).get_uri({"bucket": "protected-bucket", "key": "granule_id.nc"})
        == "http://distribution-uri:9000/DEV/protected-bucket/granule_id.nc"
    )
    assert (
        HttpUriGenerator(
            distribution_endpoint="http://distribution-uri:9000/DEV/"
        ).get_uri({"bucket": "protected-bucket", "key": "/foo/bar/granule_id.nc"})
        == "http://distribution-uri:9000/DEV/protected-bucket/foo/bar/granule_id.nc"
    )
