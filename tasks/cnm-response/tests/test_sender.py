from cnm_response.sender import KinesisSender, Message, SnsSender, get_sender


def test_message_get_sns_message_attributes():
    m = Message(
        body={},
        attributes={
            "Attr1": "Foo",
            "Attr2": 3,
            "Attr3": 3.5,
        },
    )

    assert m.get_sns_message_attributes() == {
        "Attr1": {
            "DataType": "String",
            "StringValue": "Foo",
        },
        "Attr2": {
            "DataType": "Number",
            "StringValue": "3",
        },
        "Attr3": {
            "DataType": "Number",
            "StringValue": "3.5",
        },
    }


def test_message_get_sns_message_attributes_publish(mock_sns, response_sns_topic):
    message = Message(
        body={},
        attributes={
            "Attr1": "Foo",
            "Attr2": 3,
            "Attr3": 3.5,
        },
    )

    mock_sns.publish(
        TopicArn=response_sns_topic.arn,
        Message="Foo",
        MessageAttributes=message.get_sns_message_attributes(),
    )


def test_get_sender(response_sns_topic, response_kinesis_stream):
    assert isinstance(get_sender(response_sns_topic.arn), SnsSender)
    assert isinstance(get_sender(response_kinesis_stream.arn), KinesisSender)
