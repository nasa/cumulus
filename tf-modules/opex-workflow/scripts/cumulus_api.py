"""Cumulus API."""

import json
import logging
import urllib.parse
import uuid
from collections.abc import Generator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class ApiRequest:
    """Model an HTTP request and transforms it into an AWS API Gateway event.

    Attributes:
        path (str): The URL path for the request (e.g., '/users').
        body (str): The raw request body string. Defaults to "".
        method (str): The HTTP verb (e.g., 'GET', 'POST'). Defaults to "GET".
        headers (dict): HTTP headers. Defaults to an empty dict.
        params (dict): Query string parameters (multivalue). Defaults to an empty dict.
        payload (dict): The constructed API Gateway event dictionary, generated
            automatically during initialization.

    """

    path: str
    body: str = ""
    method: str = "GET"
    headers: dict = field(default_factory=dict)
    params: dict = field(default_factory=dict)
    payload: dict = field(init=False)

    def __post_init__(self):
        """Initialize payload."""
        now = datetime.datetime.now(datetime.UTC)
        self.payload = {
            "body": self.body,
            "headers": {
                "Host": "cumulus.app",
                "X-Forwarded-For": "127.0.0.1, 127.0.0.2",
                "X-Forwarded-Port": "443",
                "X-Forwarded-Proto": "https",
                **self.headers,
            },
            "httpMethod": self.method,
            "isBase64Encoded": False,
            "multiValueHeaders": {},
            "multiValueQueryStringParameters": self.params,
            "queryStringParameters": {},
            "path": self.path,
            "pathParameters": {"proxy": self.path},
            "requestContext": {
                "httpMethod": self.method,
                "path": self.path,
                "stage": "simulated",
                "resourcePath": "/{proxy+}",
                "accountId": "1",
                "apiId": "1",
                "identity": {},
                "protocol": "HTTP/1.1",
                "requestId": str(uuid.uuid4()),
                "requestTime": now.strftime("%d/%b/%Y:%M:%H:%S %z"),
                "resourceId": "123456",
            },
            "resource": "/{proxy+}",
            "stageVariables": {},
        }


@dataclass
class ApiResponse:
    """API Response Object."""

    request: ApiRequest
    lambda_response: dict

    _json: dict = None

    def json(self):
        """Convert the API response into a JSON string."""
        if self._json is None:
            self._json = json.load(self.lambda_response["Payload"])

        return self._json


@dataclass
class ApiClient:
    """Wrap an AWS Lambda client to simulate HTTP requests against a specific function.

    This client handles the serialization of requests, invocation of the
    underlying Lambda function, and parsing of the response payload.

    Attributes:
        client (Any): An instantiated boto3 Lambda client (or compatible interface).
        function_name (str): The name or ARN of the target Lambda function.

    """

    client: Any
    function_name: str

    def request(
        self,
        method: str,
        path: str,
        body: str = "",
        headers: dict = {},
        params: dict = {},
    ) -> ApiResponse:
        """Execute a single simulated HTTP request via Lambda invocation.

        Constructs an ApiRequest, serializes it to JSON, and invokes the
        configured Lambda function with a 'RequestResponse' invocation type.

        Args:
            method: The HTTP verb (e.g., 'GET', 'POST').
            path: The resource path (e.g., '/users/123').
            body: The raw string body of the request. Defaults to "".
            headers: A dictionary of HTTP headers. Defaults to None.
            params: A dictionary of query string parameters. Defaults to None.

        """
        request = ApiRequest(
            path=path,
            body=body,
            method=method,
            headers=headers,
            params=params,
        )
        payload = json.dumps(request.payload)

        log.debug(
            "Invoking function %s with payload\n%s",
            self.function_name,
            payload,
        )

        response = self.client.invoke(
            FunctionName=self.function_name,
            InvocationType="RequestResponse",
            Payload=payload,
        )

        log.debug(
            "Function %s responded with payload\n%s",
            self.function_name,
            response,
        )
        return ApiResponse(
            request=request,
            lambda_response=response,
        )

    def paginate(
        self,
        method: str,
        path: str,
        body: str = "",
        headers: dict = {},
        params: dict = {},
    ) -> Generator[ApiResponse, None, None]:
        """Iterate through pages of results using the API's cursor logic.

        Args:
            method: The HTTP verb (e.g., 'GET', 'POST').
            path: The resource path.
            body: The raw string body of the request. Defaults to "".
            headers: A dictionary of HTTP headers. Defaults to None.
            params: A dictionary of query string parameters. Defaults to None.

        Yields:
            ApiResponse: The response object for each individual page requested.

        Stop Iteration:
            Stops automatically when:
            1. The response status code is not 200.
            2. The 'results' list in the response body is empty.

        """
        response = self.request(
            method=method,
            path=path,
            body=body,
            headers=headers,
            params=params,
        )
        http_success = 200
        while True:
            yield response

            payload = response.json()
            if payload["statusCode"] != http_success:
                return

            response_body = json.loads(payload["body"])
            if not response_body.get("results", ()):
                return
            search_context = urllib.parse.unquote(
                response_body["meta"]["searchContext"],
            )

            response = self.request(
                method=method,
                path=path,
                body=body,
                headers=headers,
                params={
                    **params,
                    "searchContext": search_context,
                },
            )
