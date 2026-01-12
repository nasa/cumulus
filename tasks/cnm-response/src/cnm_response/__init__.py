"""CNM Response task."""

from .task import CnmResponse

lambda_handler = CnmResponse.cumulus_handler
