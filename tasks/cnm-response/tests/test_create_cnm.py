import copy
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

@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_extracts_provider_from_granule(cnm_s, granule):
    """Test that missing provider in cnm_s is backfilled by granule provider."""
    gen = CnmGenerator()

    # Remove provider from cnm_s to simulate a missing field
    cnm_s_no_provider = copy.deepcopy(cnm_s)
    cnm_s_no_provider.pop("provider", None)

    # Ensure granule has a provider
    granule_with_provider = copy.deepcopy(granule) if granule else {}
    granule_with_provider["provider"] = "gesdisc_GMAO_M21C"

    result = gen.get_cnm_r(
        cnm_s=cnm_s_no_provider,
        exception="None",
        granule=granule_with_provider,
    )

    # The provider should be successfully pulled from the granule payload
    assert result["provider"] == "gesdisc_GMAO_M21C"


@freeze_time("2026-01-01 20:50:35Z")
def test_get_cnm_r_keeps_cnm_s_provider(cnm_s, granule):
    """Test that existing provider in cnm_s is NOT overwritten by granule."""
    gen = CnmGenerator()

    # Ensure cnm_s has a specific provider
    cnm_s_with_provider = copy.deepcopy(cnm_s)
    cnm_s_with_provider["provider"] = "Original_CNM_Provider"

    # Granule has a DIFFERENT provider
    granule_with_provider = copy.deepcopy(granule) if granule else {}
    granule_with_provider["provider"] = "Cumulus_Granule_Provider"

    result = gen.get_cnm_r(
        cnm_s=cnm_s_with_provider,
        exception="None",
        granule=granule_with_provider,
    )

    # Should keep the original CNM-S provider and ignore the granule's provider
    assert result["provider"] == "Original_CNM_Provider"


@freeze_time("2026-01-01 20:50:35Z")
def test_get_default_cnm_r_error_missing_provider(cnm_s):
    """Test that get_default_cnm_r_error"""
    """falls back correctly when provider is missing."""
    gen = CnmGenerator()

    # Remove provider from cnm_s
    cnm_s_no_provider = copy.deepcopy(cnm_s)
    cnm_s_no_provider.pop("provider", None)

    result = gen.get_default_cnm_r_error(
        cnm_s=cnm_s_no_provider, cause="message from cause"
    )

    # Should fall back to the "Unknown/Missing" string
    assert result["provider"] == "Unknown/Missing provider"
    # Ensure standard response fields are still intact
    assert result["response"]["status"] == "FAILURE"
    assert result["response"]["errorMessage"] == "message from cause"
