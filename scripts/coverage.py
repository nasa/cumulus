import json
import subprocess
import math
from typing_extensions import TypedDict
from typing import Dict, Any, Union
from argparse import ArgumentParser


class TestException(Exception):
    pass


class CoverageUpdateRequired(Exception):
    pass


class CoverageDict(TypedDict):
    lines: float
    branches: float
    statements: float
    functions: float


def truncateFloat(value: float, precision: int) -> Union[float, int]:
    """
    round down to the given precision
    i.e.
        - truncateFloat(99.99, 1) -> 99.9
        - truncateFloat(23.45, -1) -> 20.0
    Args:
        value (float): floating point value to be truncated
        precision (int): precision in digits to the right of the decimal

    Returns:
        float: floored value
        int: floored value if integer is equivalent for readability
    """
    shift = 10**precision
    out = math.floor(value * shift) / shift
    if int(out) == out:
        return int(out)
    return out


def generateCoverageReport() -> str:
    """
    run nyc tests, generating a json-summary to get current coverage values

    Raises:
        TestException: tests failed trying to get coverage

    Returns:
        str: path to find coverage json file
    """
    error = subprocess.call(["nyc", "--reporter=json-summary", "npm", "test"])
    if error:
        raise TestException("nyc test failed, see output above")

    # hardcoded, but ready to potentially be flexible in future
    return "coverage/coverage-summary.json"


def parseCoverageValues(
    filePath: str = "coverage/coverage-summary.json",
    precision: int = 0,
) -> CoverageDict:
    """_summary_

    Args:
        filePath (str, optional): coverage summary json file expected to exist.
            - Defaults to 'coverage/coverage-summary.json'.
        precision (int, optional): precision in digits right of decimal.
            - Defaults to 0.

    Raises:
        FileNotFoundError: the expected coverage summary file was not found.
        KeyError: coverage value not found in coverage summary file.

    Returns:
        CoverageDict: _description_
    """

    with open(filePath) as coverageFile:
        unParsedCoverageDict = json.load(coverageFile)

    return {
        covType: truncateFloat(
            unParsedCoverageDict["total"][covType]["pct"],
            precision
        )
        for covType in CoverageDict.__required_keys__
    }


def parseCoverageConfigFile(
    filePath: str = ".nycrc.json",
) -> Dict[str, Any]:
    """
    parse the current nyc configuration json file

    Args:
        filePath (str, optional): nyc configuration file to parse. Defaults to '.nycrc.json'.

    Raises:
        FileNotFoundError: expected json file not found
    Returns:
        Dict[str, Any]: json object nyc configuration
    """
    with open(filePath) as nycFile:
        config = json.load(nycFile)
    return config


def updateNYCRCFile(coverage: CoverageDict, nycConfigPath: str) -> None:
    """
    parse current .nycrc.json file and add/replace coverage values with new

    Args:
        coverage (CoverageDict): dict of coverage values by type
        nycConfigPath (str): location of nyc config:

    """
    try:
        current = parseCoverageConfigFile(nycConfigPath)
        config = {**current, **coverage}
    except FileNotFoundError:
        config = coverage
    with open(nycConfigPath, "w") as nycFile:
        jsonForm = json.dumps(config, indent=2)
        nycFile.write(jsonForm)


def validateCoverageAgainstConfig(
    coverage: CoverageDict,
    configuration: Dict[str, Any],
) -> None:
    """
    validate that currently configured coverage minimum is sufficient
    for current code state

    Args:
        coverage (CoverageDict): current coverage detected by nyc by type
        configuration (Dict[str, Any]): current nyc configuration

    Raises:
        CoverageUpdateRequired: coverage thresholding is insufficient
    """

    for coverageType, coverageValue in coverage.items():
        if coverageType not in configuration:
            raise CoverageUpdateRequired(
                f"coverage type {coverageType} not configured at all\n"
                "set this value appropriately or run 'npm run coverage:update'"
            )
        if coverageValue > configuration[coverageType]:
            raise CoverageUpdateRequired(
                f"coverage of '{coverageType}' is low\n"
                f"current coverage is {coverageValue}"
                f"but configured to require {configuration[coverageType]}\n"
                "set this value appropriately or run 'npm run coverage:update'"
            )


def validateCoverage(precision: int, nycConfigPath: str) -> None:
    reportPath = "coverage/coverage-summary.json"
    coverage = parseCoverageValues(reportPath, precision)
    configuration = parseCoverageConfigFile(nycConfigPath)
    validateCoverageAgainstConfig(coverage, configuration)


def updateCoverage(precision: int, nycConfigPath: str) -> None:
    reportPath = generateCoverageReport()
    coverage = parseCoverageValues(reportPath, precision)
    updateNYCRCFile(coverage, nycConfigPath)


def main() -> None:
    """
    run the current directory's npm test routine and capture current coverage
    then update the local nyc config to reflect these values
    """
    parser = ArgumentParser(
        prog="coverage",
        description="""
coverage runs 'nyc npm test' and sets thresholds in the local nyc config
        """,
    )
    parser.add_argument("-p", "--precision", type=int, default=0)
    parser.add_argument("-n", "--nycConfigPath", type=str, default=".nycrc.json")
    parser.add_argument("--update", type=bool, const=True, default=False, nargs="?")

    args = parser.parse_args()

    precision: int = args.precision
    nycConfigPath: str = args.nycConfigPath
    update: bool = args.update
    if update:
        updateCoverage(precision, nycConfigPath)

    else:
        validateCoverage(precision, nycConfigPath)


if __name__ == "__main__":
    main()
