"""Sender implementations."""

import json
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import boto3

_RESPONSE_CLASSES: dict[str, type["Sender"]] = {}


@dataclass
class Message:
    """Dataclass for messages sent to an SNS topic or Kinesis stream."""

    body: dict
    attributes: Mapping[str, Any]

    def get_sns_message_attributes(self) -> dict[str, dict[str, str]]:
        """Convert message attributes to AWS compatible format."""

        return {
            k: {
                "DataType": "String" if isinstance(v, str) else "Number",
                "StringValue": str(v),
            }
            for k, v in self.attributes.items()
        }


class Sender(ABC):
    """Abstract base class for message sender."""

    def __init_subclass__(cls, /, arn_type: str, **kwargs):
        super().__init_subclass__(**kwargs)

        _RESPONSE_CLASSES[arn_type] = cls

    def __init__(self, arn: str, client):
        """Construct Sender.

        :param arn: the ARN of the destination resource.
        :client: the boto3 client for the associated service.
        """
        self.arn = arn
        self.client = client

    @abstractmethod
    def send(self, message: Message):
        """Send a message to the target resource.

        :param message: the `Message` to send.
        """
        pass


class SnsSender(Sender, arn_type="sns"):
    """Class for sending messages to an SNS topic."""

    def send(self, message: Message):
        """Send a message to the SNS topic.

        :param message: the `Message` to send.
        """
        self.client.publish(
            TopicArn=self.arn,
            Subject="CNM Response",
            Message=json.dumps(message.body),
            MessageAttributes=message.get_sns_message_attributes(),
        )


class KinesisSender(Sender, arn_type="kinesis"):
    """Class for sending messages to an Kinesis stream."""

    def send(self, message: Message):
        """Send a message to the kinesis stream.

        :param message: the `Message` to send.
        """
        self.client.put_record(
            StreamARN=self.arn,
            Data=json.dumps(message.body).encode(),
            PartitionKey="1",
        )


def get_sender(response_arn: str) -> Sender:
    """Create the appropriate `Sender` from an ARN.

    :param response_arn: the ARN to send responses to.
    :return: a Sender for the response resource.
    """
    arn_type = response_arn.split(":")[2]

    cls = _RESPONSE_CLASSES[arn_type]
    return cls(response_arn, client=boto3.client(arn_type))
