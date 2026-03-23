from cnm_response.task import _get_message_attributes


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
