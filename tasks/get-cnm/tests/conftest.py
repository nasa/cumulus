"""Pytest configuration for get-cnm tests."""

from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def task_path():
    """Return the absolute task root path."""
    return Path(__file__).parent.parent.resolve()


@pytest.fixture(scope="session")
def data_path(task_path):
    """Return the shared static test data directory."""
    return task_path / "tests" / "data"


@pytest.fixture
def mocked_api(mocker):
    """Patch ``get_cnm.get_cnm.CumulusApi`` for tests.

    Returns the mocked class so tests can configure behaviors via
    ``mocked_api.return_value``.
    """
    return mocker.patch("get_cnm.get_cnm.CumulusApi")
