"""Initialize the Cumulus Logger."""

import logging
import os

from cumulus_logger import CumulusLogger

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))
