"""Pytest configuration for get-cnm tests."""

from unittest.mock import patch

import pytest


@pytest.fixture
def mocked_api():
    """Patch ``get_cnm.get_cnm.CumulusApi`` for tests.

    Returns the mocked class so tests can configure behaviors via
    ``mocked_api.return_value``.
    """
    with patch("get_cnm.get_cnm.CumulusApi") as api_mock:
        yield api_mock
