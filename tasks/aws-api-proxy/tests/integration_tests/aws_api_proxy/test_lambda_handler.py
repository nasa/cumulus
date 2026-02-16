"""Tests for aws api proxy module lambda handler."""

import jsonschema
import pytest
from main import lambda_handler


def test_lambda_handler_prohibits_additional_parameters() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected parameters are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "abc",
                "Message": "abc",
                # Subject is not permitted in the schema
                "Subject": "abc",
            },
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)


def test_lambda_handler_prohibits_additional_actions() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected actions are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            "service": "sns",
            # list_topics is not a permitted action in the schema
            "action": "list_topics",
            "parameters": {},
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)


def test_lambda_handler_prohibits_additional_services() -> None:
    """Verify that lambda_adapter fails schema validation when unexpected services are
    passed.  This is explicitly tested to assure we're setting appropriate security
    guardrails.
    """
    event = {
        "task_config": {
            # Secrets Manager is not a permitted service in the schema
            "service": "secretsmanager",
            "action": "get_secret_value",
            "parameters": {
                "SecretId": "abc",
                "VersionId": "abc",
            },
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)


def test_lambda_handler_no_filter_mapping() -> None:
    """Verify an exception is raised when no filter match is found."""
    event = {
        "task_config": {
            "service": "sns",
            "action": "publish",
            "parameters": {
                "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
                "Message": [
                    {"m": "first message"},
                    {"m": "second message"},
                ],
            },
            "iterate_by": "Message",
            "parameter_filters": [
                {
                    "name": "nonexistent_filter",
                    "field": "Message",
                }
            ],
        }
    }
    with pytest.raises(jsonschema.exceptions.ValidationError):
        lambda_handler(event, None)
