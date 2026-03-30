import pytest
from pathlib import Path


@pytest.fixture(scope="session")
def task_path():
    return Path(__file__).parent.parent.resolve()


@pytest.fixture(scope="session")
def data_path(task_path):
    return task_path / "tests" / "data"
