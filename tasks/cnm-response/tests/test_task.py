import io
import json
import urllib.parse
from collections import namedtuple

import pytest
from cnm_response.task import CnmResponse, _get_message_attributes
from freezegun import freeze_time


@pytest.fixture
def response_sqs_queue(mock_sqs, mock_sns, response_sns_topic):
    queue_name = "unit-test-cnm-response"
    queue_url = mock_sqs.create_queue(QueueName=queue_name)["QueueUrl"]

    parsed = urllib.parse.urlparse(queue_url)
    _, aws_account_id, queue_name = parsed.path.split("/")

    queue_arn = f"arn:aws:sqs:us-west-2:{aws_account_id}:{queue_name}"
    mock_sns.subscribe(
        TopicArn=response_sns_topic.arn,
        Protocol="sqs",
        Endpoint=queue_arn,
    )

    return namedtuple("Queue", ["arn", "name", "url"])(queue_arn, queue_name, queue_url)


@pytest.fixture
def granules(granule):
    return [granule]


@freeze_time("2026-01-01 20:50:35Z")
def test_cumulus_handler_sns(
    mock_sqs,
    cnm_s,
    granules,
    response_sns_topic,
    response_sqs_queue,
):
    CnmResponse.cumulus_handler(
        {
            "cma": {
                "event": {},
                "task_config": {
                    "cnm_s": cnm_s,
                    "responseArns": [response_sns_topic.arn],
                    "exception": "None",
                    "region": "us-west-2",
                },
                "payload": {
                    "granules": granules,
                },
            },
        }
    )

    response = mock_sqs.receive_message(QueueUrl=response_sqs_queue.url)

    message = response["Messages"][0]
    body = json.loads(message["Body"])

    assert json.loads(body["Message"]) == {
        "product": {
            "files": [
                {
                    "checksumType": "md5",
                    "checksum": "3b6de83e361a01867a9e541a4bf771dc",
                    "uri": "s3://test-protected/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "type": "data",
                    "size": 18795152,
                },
                {
                    "checksumType": "md5",
                    "checksum": "11236de83e361eesss332f771dc",
                    "uri": "s3://test-public/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
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
        "submissionTime": "2020-04-08 15:59:15.186779",
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
    assert body["MessageAttributes"] == {
        "CNM_RESPONSE_STATUS": {
            "Type": "String",
            "Value": "SUCCESS",
        },
        "COLLECTION": {
            "Type": "String",
            "Value": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        },
        "DATA_VERSION": {
            "Type": "String",
            "Value": "1.0",
        },
    }


@freeze_time("2026-01-01 20:50:35Z")
def test_cumulus_handler_sns_no_cmr(
    mock_sqs,
    cnm_s,
    granules,
    response_sns_topic,
    response_sqs_queue,
):
    del granules[0]["cmrConceptId"]
    del granules[0]["cmrLink"]

    CnmResponse.cumulus_handler(
        {
            "cma": {
                "event": {},
                "task_config": {
                    "cnm_s": cnm_s,
                    "responseArns": [response_sns_topic.arn],
                    "exception": "None",
                    "region": "us-west-2",
                },
                "payload": {
                    "granules": granules,
                },
            },
        }
    )

    response = mock_sqs.receive_message(QueueUrl=response_sqs_queue.url)

    message = response["Messages"][0]
    body = json.loads(message["Body"])

    assert json.loads(body["Message"]) == {
        "product": {
            "files": [
                {
                    "checksumType": "md5",
                    "checksum": "3b6de83e361a01867a9e541a4bf771dc",
                    "uri": "s3://test-protected/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "type": "data",
                    "size": 18795152,
                },
                {
                    "checksumType": "md5",
                    "checksum": "11236de83e361eesss332f771dc",
                    "uri": "s3://test-public/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
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
        "submissionTime": "2020-04-08 15:59:15.186779",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        "response": {
            "status": "SUCCESS",
        },
        "processCompleteTime": "2026-01-01 20:50:35Z",
    }
    assert body["MessageAttributes"] == {
        "CNM_RESPONSE_STATUS": {
            "Type": "String",
            "Value": "SUCCESS",
        },
        "COLLECTION": {
            "Type": "String",
            "Value": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        },
        "DATA_VERSION": {
            "Type": "String",
            "Value": "1.0",
        },
    }


@freeze_time("2026-01-01 20:50:35Z")
def test_cumulus_handler_sns_and_kinesis(
    mock_sqs,
    mock_kinesis,
    cnm_s,
    granules,
    response_sns_topic,
    response_sqs_queue,
    response_kinesis_stream,
):
    output = CnmResponse.cumulus_handler(
        {
            "cma": {
                "event": {},
                "task_config": {
                    "cnm_s": cnm_s,
                    "responseArns": [
                        response_sns_topic.arn,
                        response_kinesis_stream.arn,
                    ],
                    "exception": "None",
                    "region": "us-west-2",
                },
                "payload": {
                    "granules": granules,
                },
            },
        }
    )

    expected_cnm_r = {
        "product": {
            "files": [
                {
                    "checksumType": "md5",
                    "checksum": "3b6de83e361a01867a9e541a4bf771dc",
                    "uri": "s3://test-protected/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.nc",
                    "type": "data",
                    "size": 18795152,
                },
                {
                    "checksumType": "md5",
                    "checksum": "11236de83e361eesss332f771dc",
                    "uri": "s3://test-public/Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
                    "name": "Merged_TOPEX_Jason_OSTM_Jason-3_Cycle_945.V4_2.cmr.json",
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
        "submissionTime": "2020-04-08 15:59:15.186779",
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

    assert output == {
        "exception": "None",
        "payload": {
            "cnm": expected_cnm_r,
            "input": {
                "granules": granules,
            },
        },
        "task_config": {
            "cnm_s": cnm_s,
            "responseArns": [
                response_sns_topic.arn,
                response_kinesis_stream.arn,
            ],
            "exception": "None",
            "region": "us-west-2",
        },
    }

    message_sqs = mock_sqs.receive_message(
        QueueUrl=response_sqs_queue.url,
    )["Messages"][0]
    body = json.loads(message_sqs["Body"])

    assert json.loads(body["Message"]) == expected_cnm_r

    print(
        "getting messages from",
        response_kinesis_stream.arn,
        response_kinesis_stream.name,
    )
    shard_iterator = mock_kinesis.get_shard_iterator(
        StreamName=response_kinesis_stream.name,
        ShardId=response_kinesis_stream.shards[0]["ShardId"],
        ShardIteratorType="TRIM_HORIZON",
    )["ShardIterator"]
    records = mock_kinesis.get_records(
        ShardIterator=shard_iterator,
        Limit=10,
    )["Records"]

    assert json.load(io.BytesIO(records[0]["Data"])) == expected_cnm_r


@freeze_time("2026-01-01 20:50:35Z")
def test_cumulus_handler_sns_unexpected_error(
    mocker,
    mock_sqs,
    cnm_s,
    granules,
    response_sns_topic,
    response_sqs_queue,
):
    mocker.patch(
        "cnm_response.task.CnmGenerator.get_cnm_r",
        side_effect=Exception("Test Exception"),
    )

    with pytest.raises(Exception, match="Test Exception"):
        CnmResponse.cumulus_handler(
            {
                "cma": {
                    "event": {},
                    "task_config": {
                        "cnm_s": cnm_s,
                        "responseArns": [response_sns_topic.arn],
                        "exception": "None",
                        "region": "us-west-2",
                    },
                    "payload": {
                        "granules": granules,
                    },
                },
            }
        )

    response = mock_sqs.receive_message(QueueUrl=response_sqs_queue.url)

    message = response["Messages"][0]
    body = json.loads(message["Body"])

    assert json.loads(body["Message"]) == {
        "receivedTime": "2020-04-08T16:00:16.958Z",
        "collection": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        "version": "1.1",
        "provider": "NASA/JPL/PO.DAAC",
        "submissionTime": "2020-04-08 15:59:15.186779",
        "identifier": "c1f1be11-9cbd-4620-ad07-9a7f2afb8349",
        "response": {
            "status": "FAILURE",
            "errorCode": "PROCESSING_ERROR",
            "errorMessage": "Test Exception",
        },
        "processCompleteTime": "2026-01-01 20:50:35Z",
    }
    assert body["MessageAttributes"] == {
        "CNM_RESPONSE_STATUS": {
            "Type": "String",
            "Value": "FAILURE",
        },
        "COLLECTION": {
            "Type": "String",
            "Value": "MERGED_TP_J1_OSTM_OST_CYCLES_V42",
        },
        "DATA_VERSION": {
            "Type": "String",
            "Value": "Unknown/Missing",
        },
    }


def test_get_message_attributes_all():
    assert _get_message_attributes(
        {
            "collection": "JASON_C1",
            "product": {
                "dataVersion": "E",
                "dataProcessingType": "forward",
            },
            "response": {
                "status": "SUCCESS",
            },
            "trace": "NCMODIS_A-JPL-L2P-v2019.01",
        }
    ) == {
        "COLLECTION": "JASON_C1",
        "CNM_RESPONSE_STATUS": "SUCCESS",
        "DATA_VERSION": "E",
        "dataProcessingType": "forward",
        "trace": "NCMODIS_A-JPL-L2P-v2019.01",
    }


def test_get_message_attributes_min():
    assert _get_message_attributes(
        {
            "collection": "JASON_C1",
            "product": {
                "dataVersion": "E",
            },
            "response": {
                "status": "SUCCESS",
            },
        }
    ) == {
        "COLLECTION": "JASON_C1",
        "CNM_RESPONSE_STATUS": "SUCCESS",
        "DATA_VERSION": "E",
    }


def test_get_message_attributes_trace_none():
    assert _get_message_attributes(
        {
            "collection": "JASON_C1",
            "product": {
                "dataVersion": "E",
            },
            "response": {
                "status": "SUCCESS",
            },
            "trace": None,
        }
    ) == {
        "COLLECTION": "JASON_C1",
        "CNM_RESPONSE_STATUS": "SUCCESS",
        "DATA_VERSION": "E",
    }


def test_get_message_attributes_cnm_1_6_1():
    assert _get_message_attributes(
        {
            "collection": {
                "name": "JASON_C1",
                "version": "F08",
            },
            "product": {
                "dataVersion": "E",
            },
            "response": {
                "status": "SUCCESS",
            },
        }
    ) == {
        "COLLECTION": "JASON_C1",
        "CNM_RESPONSE_STATUS": "SUCCESS",
        "DATA_VERSION": "E",
    }
