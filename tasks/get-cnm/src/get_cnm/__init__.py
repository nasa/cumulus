"""Get CNM task for Cumulus.

This module retrieves the originating CNM message for a specified granule.
"""

import logging
import os

from cumulus_logger import CumulusLogger

LOGGER = CumulusLogger(__name__, level=int(os.environ.get("LOGLEVEL", logging.DEBUG)))
