import json
import subprocess
import math

from typing import Dict, Any, Union, Literal
from argparse import ArgumentParser


class TestException(Exception):
    pass


class CoverageUpdateRequired(Exception):
    pass


CoverageDict = Dict[
    Literal["lines", "branches", "statements", "functions"],
    float
]


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


def generateCoverageReport(run: bool = True) -> str:
    """
    run nyc tests, generating a json-summary to get current coverage values

    Raises:
        TestException: tests failed trying to get coverage

    Returns:
        str: path to find coverage json file
    """
    if run:
        error = subprocess.call(["nyc", "--reporter=json-summary", "npm", "test"])
    else:
        error = subprocess.call(["nyc", "--reporter=json-summary", "report"])

    if error:
        raise TestException("nyc failed, see output above")

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
        for covType in ["lines", "branches", "statements", "functions"]
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


def updateNYCRCFile(
    coverage: CoverageDict,
    nycConfigPath: str,
    grace: int,
) -> None:
    """
    parse current .nycrc.json file and add/replace coverage values with new

    Args:
        coverage (CoverageDict): dict of coverage values by type
        nycConfigPath (str): location of nyc config:

    """
    grace_coverage = {key: value - grace for key, value in coverage.items()}
    try:
        current = parseCoverageConfigFile(nycConfigPath)
        config = {**current, **grace_coverage}
    except FileNotFoundError:
        config = coverage
    with open(nycConfigPath, "w") as nycFile:
        jsonForm = json.dumps(config, indent=2)
        nycFile.write(jsonForm)


def validateCoverageAgainstConfig(
    coverage: CoverageDict,
    configuration: Dict[str, Any],
    grace: int,
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
    badCoverages = []
    for coverageType, coverageValue in coverage.items():
        if coverageType not in configuration:
            raise CoverageUpdateRequired(
                f"coverage type {coverageType} not configured at all\n"
                "set this value appropriately or run 'npm run coverage:update'"
            )
        if coverageValue > (configuration[coverageType] + grace):
            badCoverages.append(coverageType)
    if badCoverages:
        insufficientDict = {type: configuration[type] for type in badCoverages}
        raise CoverageUpdateRequired(
            f"currently configured coverage {insufficientDict}\n"
            f"is low against current coverage is {coverage}\n"
            "set this configuration appropriately or run\n"
            "'npm run coverage:update'"
        )


def validateCoverage(
    precision: int, grace: int, noRerun: bool, nycConfigPath: str
) -> None:
    reportPath = generateCoverageReport(not noRerun)
    coverage = parseCoverageValues(reportPath, precision)
    configuration = parseCoverageConfigFile(nycConfigPath)
    validateCoverageAgainstConfig(coverage, configuration, grace)


def updateCoverage(
    precision: int, grace: int, noRerun: bool, nycConfigPath: str
) -> None:
    reportPath = generateCoverageReport(not noRerun)
    coverage = parseCoverageValues(reportPath, precision)
    updateNYCRCFile(coverage, nycConfigPath, grace)


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
    parser.add_argument(
        "-p",
        "--precision",
        type=int,
        default=0,
        help="precision to use in figures to the right of decimal." "defaults to 0",
    )
    parser.add_argument(
        "-n",
        "--nycConfigPath",
        type=str,
        default=".nycrc.json",
        help="nyc configuration filepath to use." "defaults to .nycrc.json",
    )
    parser.add_argument(
        "-g",
        "--grace",
        type=int,
        default=0,
        help="grace to give thresholds."
        "if validating, don't fail if coverage is < g above threshold."
        "if updating, set threshold to t-g.",
    )
    parser.add_argument(
        "--noRerun",
        type=bool,
        const=True,
        default=False,
        nargs="?",
        help="use existing coverage report instead of generating new"
        "if unset, will rerun tests to generate report",
    )
    parser.add_argument(
        "--update",
        type=bool,
        const=True,
        default=False,
        nargs="?",
        help="update nyc thresholds to current code coverage",
    )

    args = parser.parse_args()
    update: bool = args.update
    if update:
        updateCoverage(args.precision, args.grace, args.noRerun, args.nycConfigPath)

    else:
        validateCoverage(args.precision, args.grace, args.noRerun, args.nycConfigPath)


if __name__ == "__main__":
    main()
