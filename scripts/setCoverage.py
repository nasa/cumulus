import json
import subprocess
import math
from typing_extensions import TypedDict
from typing import Dict, Union
import time
from argparse import ArgumentParser

class TestException(Exception):
    pass

class CoverageDict(TypedDict):
    lines: float
    branches: float
    statements: float
    functions: float

def truncateFloat(value: float, precision: int) -> float:
    shift = 10**precision
    return math.floor(value * shift)/shift

def generateCoverageReport() -> str:
    """
    run nyc tests, generating a json-summary to get current coverage values from

    Raises:
        TestException: tests failed trying to get coverage

    Returns:
        str: path to find coverage json file
    """
    for _ in range(10):
        error = subprocess.call(["nyc", "--reporter=json-summary", "npm", "test"])
        if not error:
            # hardcoded, but ready to potentially be flexible in future
            return "coverage/coverage-summary.json"
        time.sleep(10)
    else:    
        raise TestException("nyc test failed, see output above")


def parseCoverageValues(coveragePath: str, precision: int) -> CoverageDict:
    """
    extract lines, branches, functions, statements total coverage percentage values
    assumes those values are to be found at "total.<type>.pct"

    Args:
        coveragePath (str): filePath to find json summary
        precision (int): coveragePrecision as position to the right of decimal

    Returns:
        CoverageDict: dict of coverage values by type
    """
    with open(coveragePath) as coverageFile:
        unParsedCoverageDict = json.load(coverageFile)
    
    return {
        covType: truncateFloat(unParsedCoverageDict['total'][covType]['pct'], precision)
        for covType in ["lines", "branches", "functions", "statements"]
    }
    
    
def updateNYCRCFile(coverage: CoverageDict, nycConfigPath: str) -> None:
    """
    parse current .nycrc.json file and add/replace coverage values with new

    Args:
        coverage (CoverageDict): dict of coverage values by type
        nycConfigPath (str): location of nyc config:

    """
    try:
        with open(nycConfigPath) as nycFile:
            current = json.load(nycFile)
        config = {
            **current,
            **coverage
        }
    except FileNotFoundError:
        config = coverage
    with open(nycConfigPath, "w") as nycFile:
        jsonForm = json.dumps(config, indent=2)
        nycFile.write(jsonForm)
    
def main() -> None:
    """
    run the current directory's npm test routine and capture current coverage
    then update the local nyc config to reflect these values
    """
    parser = ArgumentParser(
        prog="setCoverage",
        description="""
setCoverage runs 'nyc npm test' and sets thresholds in the local nyc config
        """,
    )
    parser.add_argument("-p", "--precision", type=int, default=0)
    parser.add_argument("-n", "--nycConfigPath", type=str, default=".nycrc.json")
    
    args = parser.parse_args()
    
    precision: int = args.precision
    nycConfigPath: str = args.nycConfigPath
    reportPath = generateCoverageReport()
    coverage = parseCoverageValues(reportPath, precision)
    updateNYCRCFile(coverage, nycConfigPath)

if __name__ == "__main__":
    main()