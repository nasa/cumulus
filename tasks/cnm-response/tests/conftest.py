import os
from collections import namedtuple

import boto3
import moto
import pytest


@pytest.fixture(autouse=True)
def aws_credentials():
    """Mock AWS Credentials for moto."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"  # noqa: S105
    os.environ["AWS_SECURITY_TOKEN"] = "testing"  # noqa: S105
    os.environ["AWS_SESSION_TOKEN"] = "testing"  # noqa: S105
    os.environ["AWS_DEFAULT_REGION"] = "us-west-2"


@pytest.fixture
def mock_kinesis():
    with moto.mock_aws():
        yield boto3.client("kinesis")


@pytest.fixture
def mock_sns():
    with moto.mock_aws():
        yield boto3.client("sns")


@pytest.fixture
def mock_sqs():
    with moto.mock_aws():
        yield boto3.client("sqs")


@pytest.fixture
def response_sns_topic(mock_sns):
    topic_name = "unit-test-cnm-response"
    topic_arn = mock_sns.create_topic(Name=topic_name)["TopicArn"]

    return namedtuple("Topic", ["arn", "name"])(topic_arn, topic_name)


@pytest.fixture
def response_kinesis_stream(mock_kinesis):
    stream_name = "unit-test-cnm-response"
    mock_kinesis.create_stream(
        StreamName="unit-test-cnm-response",
        ShardCount=1,
    )
    mock_kinesis.get_waiter("stream_exists").wait(StreamName=stream_name)
    response = mock_kinesis.describe_stream(StreamName=stream_name)
    info = response["StreamDescription"]

    return namedtuple("Stream", ["arn", "name", "shards"])(
        info["StreamARN"],
        stream_name,
        info["Shards"],
    )


@pytest.fixture
def granule():
    return {
        "files": [
            {
                "checksumType": "md5",
                "fileName": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                "checksum": "3b6de83e361a01867a9e541a4bf771dc",
                "bucket": "test-protected",
                "key": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                "type": "data",
                "size": 18795152,
            },
            {
                "fileName": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                "key": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                "checksumType": "md5",
                "checksum": "11236de83e361eesss332f771dc",
                "bucket": "test-public",
                "type": "metadata",
                "size": 1236,
            },
        ],
        "cmrLink": "https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=G1234313662-POCUMULUS",
        "cmrConceptId": "G1234313662-POCUMULUS",
        "dataType": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "cmrMetadataFormat": "umm_json_v1_6",
        "sync_granule_duration": 3136,
        "granuleId": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2",
        "version": "1",
        "published": True,
        "post_to_cmr_duration": 11650,
    }


@pytest.fixture
def cnm_s():
    return {
        "product": {
            "files": [
                {
                    "checksumType": "md5",
                    "checksum": "",
                    "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "type": "data",
                    "size": 18795152,
                },
                {
                    "checksumType": "md5",
                    "checksum": "",
                    "uri": "s3://podaac-sndbx-staging/c1f1be11-9cbd-4620-ad07-9a7f2afb8349/store/merged_alt/open/L2/TP_J1_OSTM/cycles/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc.md5",
                    "type": "data",
                    "size": 83,
                },
            ],
            "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
            "dataVersion": "1.0",
        },
        "receivedTime": "2020-04-08T16:00:16.958Z",
        "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "version": "1.1",
        "provider": "NASA/JPL/PO.DAAC",
        "submissionTime": "2020-04-08 15:59:15.186779",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
    }
