def get_cmr_url(cmr_env: str) -> str:
    return f"https://{get_cmr_hostname(cmr_env)}"


def get_cmr_hostname(cmr_env: str) -> str:
    return {
        "PROD": "cmr.earthdata.nasa.gov",
        "OPS": "cmr.earthdata.nasa.gov",
        "UAT": "cmr.uat.earthdata.nasa.gov",
        "SIT": "cmr.sit.earthdata.nasa.gov",
    }[cmr_env]
