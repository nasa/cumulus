"""Reference python activity implementaion.

Creates a stub cumulus-process-py stub implementation that
takes a payload and returns a mocked output for test purposes
"""

from cumulus_process import Process


class TestProcess(Process):
    """Stub class implementation that returns mocked values
    for processing output.
    """

    def process(self):
        return {
            "fake_output1": "first fake output",
            "fake_output2": "second fake output",
        }


if __name__ == "__main__":
    PROCESS = TestProcess({})
    PROCESS.cumulus_activity()
