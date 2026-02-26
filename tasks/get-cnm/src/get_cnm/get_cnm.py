"""Get CNM task for Cumulus.

This module retrieves the originating CNM message for a specified granule.  This is
accomplished by;
1. Searching for executions associated with the incoming granules
2. Binning the executions by granule ID
3. Sorting the executions for each granule by timestamp
4. If the oldest execution has `parentArn`, retrieve the parent execution and return
its input as the CNM message.  If not, return the input of the oldest execution as the
CNM message.

This assumes that the oldest execution associated with a granule is the one that was
triggered by the CNM message and the original payload of that execution is the CNM
message that corresponds to this granule.

"""

from typing import Any

from cumulus_api import CumulusApi

from . import LOGGER


def build_input(data: dict) -> dict:
    """Build the input for the search_executions_by_granules method."""
    return {
        "granules": [
            {
                "granuleId": granule["granuleId"],
                "collectionId": f"{granule['dataType']}___{granule['version']}",
            }
            for granule in data["granules"]
        ]
    }


def handle_parent_execution(execution: dict, api: CumulusApi) -> dict | None:
    """Handle the case where the oldest execution has a parentArn by retrieving the
    parent execution and returning its original payload.
    """
    if "parentArn" in execution:
        # This is the oldest execution associated with the granule, but since it has a
        # parent, we need to retrieve the parent execution to get the CNM message
        LOGGER.info("Found execution with parentArn, retrieving parent execution")
        parent_execution = api.get_execution(execution["parentArn"])
        return parent_execution["originalPayload"]
    return None


def get_oldest_execution(executions: list[dict]) -> dict:
    """Get the oldest execution from a list of executions."""
    executions.sort(key=lambda x: x["finalPayload"]["granules"][0]["createdAt"])
    return executions[0]


def lambda_adapter(event: dict, _: Any) -> dict[str, Any]:
    """Handle Get CNM requests."""
    event_input = event["input"]
    api = CumulusApi()
    LOGGER.info(
        f"Processing granule IDs {
            [granule['granuleId'] for granule in event_input['granules']]
        }"
    )

    executions = api.search_executions_by_granules(
        build_input(event_input), limit=None
    ).get("results", [])
    LOGGER.info(
        f"Found {len(executions)} executions associated with the incoming granules"
    )

    # These executions are not guaranteed to be in order, so we need to bin them by
    # granule ID and sort them by timestamp to grab the oldest one
    executions_by_granule: dict[str, list[dict]] = {
        granule["granuleId"]: [] for granule in event_input["granules"]
    }
    for execution in executions:
        granule_id = execution["finalPayload"]["granules"][0]["granuleId"]
        executions_by_granule[granule_id].append(execution)

    execution_map = {}
    for granule_id, executions in executions_by_granule.items():
        if not executions:
            raise ValueError(f"No executions found for granule {granule_id}")
        oldest_execution = get_oldest_execution(executions)
        execution_map[granule_id] = (
            handle_parent_execution(oldest_execution, api)
            or oldest_execution["originalPayload"]
        )

        # sanity-check the granule ID in the CNM message matches the producer Granule ID
        cnm_granule_id = execution_map[granule_id].get("product", {}).get("name")
        if cnm_granule_id is None or cnm_granule_id not in granule_id:
            raise ValueError(
                f"Found differing granule IDs for granule in CNM message "
                f"({cnm_granule_id}) and Cumulus message ({granule_id})"
            )
    LOGGER.info(f"Successfully retrieved CNM messages: {list(execution_map)}")
    return execution_map
