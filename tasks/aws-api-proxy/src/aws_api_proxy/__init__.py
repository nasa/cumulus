"""AWS API proxy task for Cumulus.

This module provides a CMA-wrapped way to call a specified boto3 client within AWS
lambda. This may be called once or multiple times against a provided list. Guardrails
are provided via configuration validation which specifies a predefined set of allowed
services and actions in addition to a dedicated IAM role for this lambda.
"""

import logging
import os

from cumulus_logger import CumulusLogger

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))
