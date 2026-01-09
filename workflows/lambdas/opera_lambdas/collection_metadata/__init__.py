import re

CSLC_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L2)
    _
    (?P<product_short_name>CSLC-S1)
    _
    (?P<burst_id>T\d{3}-\d{6}-(?P<subswath>(?P<beam_mode>IW|EW)(?P<beam_mode_index>[1-5])))
    _
    (?P<date_time>\d{8}T\d{6}Z)
    _
    (?P<product_generation_date_time>\d{8}T\d{6}Z)
    _
    (?P<platform>S1[A-Z])
    _
    (?P<polarization>VV|VH|HH|HV)
    _
    (?P<product_version>v\d\.\d)
"""

CSLC_FILE_NAME_REGEX = rf"""
    {CSLC_GRANULE_REGEX}
    \.
    (?P<extension>h5)
"""

CSLC_STATIC_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L2)
    _
    (?P<product_short_name>CSLC-S1-STATIC)
    _
    (?P<burst_id>T\d{3}-\d{6}-(?P<subswath>(?P<beam_mode>IW|EW)(?P<beam_mode_index>[1-5])))
    _
    (?P<validity_start_date>\d{8})
    _
    # Optional production datetime so that CALVAL can have it
    (?P<production_datetime>\d{8}T\d{6}Z_)?
    (?P<platform>S1[A-Z])
    _
    (?P<product_version>v\d\.\d)
"""

CSLC_STATIC_FILE_NAME_REGEX = rf"""
    {CSLC_STATIC_GRANULE_REGEX}
    \.
    (?P<extension>(h5|iso\.xml))
"""

DISP_GRANULE_REGEX = r"""
    (?P<prefix>
        (?P<mission>OPERA)
        _
        (?P<level>L3)
        _
        (?P<product_short_name>DISP-S1)
    )
    _
    (?P<stack_id>
        (?P<beam_mode>IW|EW)
        _
        (?P<burst_id>F\d{5})
        _
        (?P<polarization>VV|VH|HH|HV)
    )
    _
    (?P<date_time_1>\d{8}T\d{6}Z)
    _
    (?P<date_time_2>\d{8}T\d{6}Z)
    _
    (?P<product_version>v\d\.\d)
    _
    (?P<product_generation_date_time>\d{8}T\d{6}Z)
"""

DISP_FILE_NAME_REGEX = rf"""
    {DISP_GRANULE_REGEX}
    \.
    (?P<extension>(nc|iso\.xml))
"""

DISP_STACK_GRANULE_REGEX = r"""
    (?P<granule_id>
        (?P<mission>OPERA)
        _
        (?P<level>L3)
        _
        (?P<product_short_name>DISP-S1)
        _
        (?P<stack_id>
            (?P<beam_mode>IW|EW)
            _
            (?P<burst_id>F\d{5})
            _
            (?P<polarization>VV|VH|HH|HV)
        )
    )
    _
    (?P<collection_maturity>.*)
"""

DISP_STATIC_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L3)
    _
    (?P<product_short_name>DISP-S1-STATIC)
    _
    (?P<burst_id>F\d{5})
    _
    (?P<validity_start_date>\d{8})
    _
    (?P<platform>S1[A-Z])
    _
    (?P<product_version>v\d\.\d)
"""

# TODO(gjclark): Should it include all these files?
#  (?P < extension > (_layover_shadow_mask | _los_enu | _dem_warped_utm | _BROWSE.iso\.xml))
DISP_STATIC_FILE_NAME_REGEX = rf"""
    {DISP_STATIC_GRANULE_REGEX}
    (?P<extension>(.tif|.iso\.xml))
"""

# TODO(bbarton) obvs
# No product spec
DIST_ALERT_GRANULE_REGEX = r"""
.*(?P<level>L3).*
"""

RTC_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L2)
    _
    (?P<product_short_name>RTC-S1)
    _
    (?P<burst_id>T\d{3}-\d{6}-(?P<subswath>(?P<beam_mode>IW|EW)(?P<beam_mode_index>[1-5])))
    _
    (?P<start_date_time>\d{8}T\d{6}Z)
    _
    (?P<product_generation_date_time>\d{8}T\d{6}Z)
    _
    (?P<platform>S1[A-Z])
    _
    (?P<_>.*)
"""

RTC_FILE_NAME_REGEX = rf"""
    {RTC_GRANULE_REGEX}
    \.
    (?P<extension>h5)
    """

RTC_STATIC_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L2)
    _
    (?P<product_short_name>RTC-S1-STATIC)
    _
    (?P<burst_id>T\d{3}-\d{6}-(?P<subswath>(?P<beam_mode>IW|EW)(?P<beam_mode_index>[1-5])))
    _
    (?P<validity_start_date>\d{8})
    _
    # Optional production datetime so that CALVAL can have it
    (?P<production_datetime>\d{8}T\d{6}Z_)?
    (?P<platform>S1[A-Z])
    _
    (?P<_>.*)  # catch-all for pixel spacing, product version, and layer name
"""

RTC_STATIC_FILE_NAME_REGEX = rf"""
    {RTC_STATIC_GRANULE_REGEX}
    \.
    (?P<extension>tif)
"""
# OPERA_L4_TROPO-ZENITH_20250626T000000Z_20250630T000712Z_HRES_v0.2
TROPO_GRANULE_REGEX = r"""
    (?P<mission>OPERA)
    _
    (?P<level>L4)
    _
    (?P<product_short_name>TROPO-ZENITH)
    _
    (?P<weather_model_datetime>\d{8}T\d{6}Z)
    _
    (?P<production_datetime>\d{8}T\d{6}Z)
    _
    (?P<nwp_name>ERA5|HRES|HRRR)
    _
    (?P<product_version>v\d\.\d)
"""

TROPO_FILE_NAME_REGEX = rf"""
    {TROPO_GRANULE_REGEX}
    \.
    (?P<extension>nc)
"""


CSLC_FILE_NAME_PATTERN = re.compile(CSLC_FILE_NAME_REGEX, re.VERBOSE)
CSLC_GRANULE_PATTERN = re.compile(CSLC_GRANULE_REGEX, re.VERBOSE)
CSLC_STATIC_FILE_NAME_PATTERN = re.compile(CSLC_STATIC_FILE_NAME_REGEX, re.VERBOSE)
CSLC_STATIC_GRANULE_PATTERN = re.compile(CSLC_STATIC_GRANULE_REGEX, re.VERBOSE)

DISP_FILE_NAME_PATTERN = re.compile(DISP_FILE_NAME_REGEX, re.VERBOSE)
DISP_GRANULE_PATTERN = re.compile(DISP_GRANULE_REGEX, re.VERBOSE)
DISP_STATIC_FILE_NAME_PATTERN = re.compile(DISP_STATIC_FILE_NAME_REGEX, re.VERBOSE)
DISP_STATIC_GRANULE_PATTERN = re.compile(DISP_STATIC_GRANULE_REGEX, re.VERBOSE)

DISP_STACK_GRANULE_PATTERN = re.compile(DISP_STACK_GRANULE_REGEX, re.VERBOSE)

DIST_ALERT_GRANULE_PATTERN = re.compile(DIST_ALERT_GRANULE_REGEX, re.VERBOSE)

RTC_FILE_NAME_PATTERN = re.compile(RTC_FILE_NAME_REGEX, re.VERBOSE)
RTC_GRANULE_PATTERN = re.compile(RTC_GRANULE_REGEX, re.VERBOSE)
RTC_STATIC_FILE_NAME_PATTERN = re.compile(RTC_STATIC_FILE_NAME_REGEX, re.VERBOSE)
RTC_STATIC_GRANULE_PATTERN = re.compile(RTC_STATIC_GRANULE_REGEX, re.VERBOSE)

TROPO_FILE_NAME_PATTERN = re.compile(TROPO_FILE_NAME_REGEX, re.VERBOSE)
TROPO_GRANULE_PATTERN = re.compile(TROPO_GRANULE_REGEX, re.VERBOSE)

PGE_VERSION_PATTERN = re.compile("PGEName: (.+) PGEVersion: (.+)")
