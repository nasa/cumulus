from cumulus_process import Process


class TestProcess(Process):
    # In production code this would be defined in a seperate class file
    def process(self):
        return {
            "fake_output1": "first fake output",
            "fake_output2": "second fake output"
        }


if __name__ == "__main__":
    process = TestProcess({})
    process.cumulus_activity()
