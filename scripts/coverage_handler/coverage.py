# /// script
# requires-python = ">=3.12.0
# dependencies = []
# ///

import json
import math
import os
import subprocess
from argparse import ArgumentParser
from copy import deepcopy
from typing import Any


class TestException(Exception):
    pass


class CoverageUpdateRequired(Exception):
    pass


CoverageDict = dict[str, float]


def truncate_float(value: float, precision: int) -> float | int:
    """Round down to the given precision.

    i.e.
        - truncate_float(99.99, 1) -> 99.9
        - truncate_float(23.45, -1) -> 20.0
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


def generate_coverage_report(run: bool = True) -> str:
    """Run nyc tests, generating a json-summary to get current coverage values.

    Args:
        run (bool, optional): run the tests to get coverage. Defaults to True

    Raises:
        TestException: tests failed trying to get coverage

    Returns:
        str: path to find coverage json file

    """
    env = deepcopy(os.environ)
    env["FAIL_ON_COVERAGE"] = "false"
    if run:
        error = subprocess.call(
            ["nyc", "--reporter=json-summary", "--reporter=text", "npm", "test"],
            env=env,
        )
    else:
        error = subprocess.call(["nyc", "--reporter=json-summary", "report"], env=env)

    if error:
        raise TestException("nyc failed, see output above")

    # hardcoded, but ready to potentially be flexible in future
    return "coverage/coverage-summary.json"


def parse_coverage_values(
    file_path: str = "coverage/coverage-summary.json",
    precision: int = 0,
) -> CoverageDict:
    """Parse coverage values from nyc report.

    Args:
        file_path (str, optional): coverage summary json file expected to exist.
            - Defaults to 'coverage/coverage-summary.json'.
        precision (int, optional): precision in digits right of decimal.
            - Defaults to 0.

    Raises:
        FileNotFoundError: the expected coverage summary file was not found.
        KeyError: coverage value not found in coverage summary file.

    Returns:
        CoverageDict: current coverage values according to recent test

    """
    with open(file_path) as coverage_file:
        unparsed_coverage_dict = json.load(coverage_file)

    return {
        cov_type: truncate_float(
            unparsed_coverage_dict["total"][cov_type]["pct"], precision
        )
        for cov_type in ["lines", "branches", "statements", "functions"]
    }


def parse_coverage_config_file(
    file_path: str = ".nycrc.json",
) -> dict[str, Any]:
    """Parse the current nyc configuration json file.

    Args:
        file_path (str, optional): nyc configuration file to parse.
            -   Defaults to '.nycrc.json'.

    Raises:
        FileNotFoundError: expected json file not found
    Returns:
        Dict[str, Any]: json object nyc configuration

    """
    with open(file_path) as nyc_file:
        config = json.load(nyc_file)
    return config


def update_nycrc_file(
    coverage: CoverageDict,
    nyc_config_path: str,
    grace: int,
) -> None:
    """Parse current .nycrc.json file and add/replace coverage values with new.

    Args:
        coverage (CoverageDict): dict of coverage values by type
        nyc_config_path (str): location of nyc config
        grace (int): grace to give to future nyc tests

    """
    grace_coverage = {key: value - (grace / 2) for key, value in coverage.items()}
    try:
        current = parse_coverage_config_file(nyc_config_path)
        config = {**current, **grace_coverage}
    except FileNotFoundError:
        config = coverage
    with open(nyc_config_path, "w") as nyc_file:
        json_form = json.dumps(config, indent=2)
        nyc_file.write(json_form)


def validate_coverage_against_config(
    coverage: CoverageDict,
    configuration: dict[str, Any],
    grace: int,
) -> None:
    """Validate that currently configured coverage minimum is sufficient
    for current code state.

    Args:
        coverage (CoverageDict): current coverage detected by nyc by type
        configuration (Dict[str, Any]): current nyc configuration
        grace (int): grace to give to configured coverage values before failing

    Raises:
        CoverageUpdateRequired: coverage thresholding is insufficient

    """
    bad_coverages = []
    for coverage_type, coverage_value in coverage.items():
        if coverage_type not in configuration:
            raise CoverageUpdateRequired(
                f"coverage type {coverage_type} not configured at all\n"
                "set this value appropriately or run 'npm run coverage -- --update'"
            )
        if coverage_value > (configuration[coverage_type] + grace):
            bad_coverages.append(coverage_type)
    if bad_coverages:
        insufficient_dict = {type: configuration[type] for type in bad_coverages}
        raise CoverageUpdateRequired(
            f"currently configured coverage {insufficient_dict}\n"
            f"is low against current coverage is {coverage}\n"
            "set this configuration appropriately or run\n"
            "'npm run coverage -- --update'"
        )


def validate_coverage(
    precision: int, grace: int, no_rerun: bool, nyc_config_path: str
) -> None:
    """Check coverage and fail if configuration is too low.

    Args:
        precision (int): precision in digits right of decimal.
        grace (int): grace to give to configured coverage values.
        no_rerun (bool): don't rerun the tests, use existing nyc_output.
        nyc_config_path (str): nyc configuration path.

    """
    report_path = generate_coverage_report(not no_rerun)
    coverage = parse_coverage_values(report_path, precision)
    configuration = parse_coverage_config_file(nyc_config_path)
    validate_coverage_against_config(coverage, configuration, grace)


def update_coverage(
    precision: int, grace: int, no_rerun: bool, nyc_config_path: str
) -> None:
    """Update configured coverage to current values.

    Args:
        precision (int): precision in digits right of decimal.
        grace (int): grace to give to configured coverage values before failing
        no_rerun (bool): don't rerun the tests, use existing nyc_output
        nyc_config_path (str): nyc configuration path.

    """
    report_path = generate_coverage_report(not no_rerun)
    coverage = parse_coverage_values(report_path, precision)
    update_nycrc_file(coverage, nyc_config_path, grace)


def main() -> None:
    """Run the current directory's npm test routine and capture current coverage
    then update the local nyc config to reflect these values.
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
        help="precision to use in figures to the right of decimal.defaults to 0",
    )
    parser.add_argument(
        "-n",
        "--nyc_config_path",
        type=str,
        default=".nycrc.json",
        help="nyc configuration file_path to use.defaults to .nycrc.json",
    )
    parser.add_argument(
        "-g",
        "--grace",
        type=int,
        default=6,
        help="grace to give thresholds."
        "if validating, don't fail if coverage is < g above threshold."
        "if updating, set threshold to t-(g/2).",
    )
    parser.add_argument(
        "--no_rerun",
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
        update_coverage(
            args.precision,
            args.grace,
            args.no_rerun,
            args.nyc_config_path,
        )

    else:
        validate_coverage(
            args.precision,
            args.grace,
            args.no_rerun,
            args.nyc_config_path,
        )


if __name__ == "__main__":
    main()
