'use strict';

const getWorkflowStatusResp =
  [{
    id: 'DiscoverVIIRS',
    success_ratio: {
      successes: 1940,
      total: 1940
    },
    ingest_perf: [{
      50: 23000,
      95: 204650,
      date: 1493856000000
    }, {
      50: 23000,
      95: 206649.99999999997,
      date: 1493942400000
    }, {
      50: 23000,
      95: 202000,
      date: 1494028800000
    }, {
      50: 23000,
      95: 199700,
      date: 1494115200000
    }, {
      50: 23000,
      95: 194649.99999999997,
      date: 1494201600000
    }, {
      50: 23000,
      95: 193700,
      date: 1494288000000
    }, {
      50: 22000,
      95: 192350,
      date: 1494374400000
    }],
    products: [{
      id: 'VNGCR_LQD_C1',
      last_execution: {
        stop_date: 1494438140000,
        success: true
      },
      success_ratio: {
        successes: 647,
        total: 647
      },
      ingest_perf: [{
        50: 194000,
        95: 209000,
        date: 1493856000000
      }, {
        50: 195000,
        95: 209500,
        date: 1493942400000
      }, {
        50: 190000,
        95: 212500,
        date: 1494028800000
      }, {
        50: 193000,
        95: 205250,
        date: 1494115200000
      }, {
        50: 189000,
        95: 198000,
        date: 1494201600000
      }, {
        50: 189000,
        95: 198500,
        date: 1494288000000
      }, {
        50: 186000,
        95: 197500,
        date: 1494374400000
      }],
      num_running: 0
    }, {
      id: 'VNGCR_SQD_C1',
      last_execution: {
        stop_date: 1494438058000,
        success: true
      },
      success_ratio: {
        successes: 647,
        total: 647
      },
      ingest_perf: [{
        50: 23000,
        95: 25000,
        date: 1493856000000
      }, {
        50: 23000,
        95: 26000,
        date: 1493942400000
      }, {
        50: 22000,
        95: 26000,
        date: 1494028800000
      }, {
        50: 23000,
        95: 25000,
        date: 1494115200000
      }, {
        50: 22000,
        95: 24000,
        date: 1494201600000
      }, {
        50: 22000,
        95: 24000,
        date: 1494288000000
      }, {
        50: 22000,
        95: 24000,
        date: 1494374400000
      }],
      num_running: 0
    }, {
      id: 'VNGCR_NQD_C1',
      last_execution: {
        success: true,
        stop_date: 1494438334000
      },
      success_ratio: {
        successes: 646,
        total: 646
      },
      ingest_perf: [{
        50: 21000,
        95: 23000,
        date: 1493856000000
      }, {
        50: 21000,
        95: 23000,
        date: 1493942400000
      }, {
        50: 20000,
        95: 23000,
        date: 1494028800000
      }, {
        50: 21000,
        95: 23000,
        date: 1494115200000
      }, {
        50: 21000,
        95: 24000,
        date: 1494201600000
      }, {
        50: 21000,
        95: 23299.999999999996,
        date: 1494288000000
      }, {
        50: 21000,
        95: 22450.000000000004,
        date: 1494374400000
      }],
      num_running: 0
    }],
    name: 'VIIRS Discovery'
  }, {
    id: 'IngestVIIRS',
    success_ratio: {
      successes: 22531,
      total: 22572
    },
    ingest_perf: [{
      50: 1031.25,
      95: 4000,
      date: 1493856000000
    }, {
      50: 1000,
      95: 5000,
      date: 1493942400000
    }, {
      50: 1000,
      95: 5000,
      date: 1494028800000
    }, {
      50: 1000,
      95: 5000,
      date: 1494115200000
    }, {
      50: 1000,
      95: 5000,
      date: 1494201600000
    }, {
      50: 1000,
      95: 5000,
      date: 1494288000000
    }, {
      50: 1000,
      95: 5000,
      date: 1494374400000
    }],
    products: [{
      id: 'VNGCR_LQD_C1',
      last_execution: {
        success: true,
        stop_date: 1494438566000
      },
      last_granule_id: '2017130',
      success_ratio: {
        successes: 7852,
        total: 7853
      },
      ingest_perf: [{
        50: 2000,
        95: 272599.9999999995,
        date: 1493856000000
      }, {
        50: 2000,
        95: 276049.9999999997,
        date: 1493942400000
      }, {
        50: 2000,
        95: 301800.0000000002,
        date: 1494028800000
      }, {
        50: 2000,
        95: 264599.9999999999,
        date: 1494115200000
      }, {
        50: 2000,
        95: 210800.0000000004,
        date: 1494201600000
      }, {
        50: 2000,
        95: 297133.3333333338,
        date: 1494288000000
      }, {
        50: 2000,
        95: 293199.99999999936,
        date: 1494374400000
      }],
      num_running: 0
    }, {
      id: 'VNGCR_NQD_C1',
      last_execution: {
        stop_date: 1494438411000,
        success: true
      },
      last_granule_id: '2017130',
      success_ratio: {
        successes: 7517,
        total: 7557
      },
      ingest_perf: [{
        50: 1000,
        95: 2000,
        date: 1493856000000
      }, {
        50: 1000,
        95: 2000,
        date: 1493942400000
      }, {
        50: 1000,
        95: 2000,
        date: 1494028800000
      }, {
        50: 1000,
        95: 2000,
        date: 1494115200000
      }, {
        50: 1000,
        95: 2000,
        date: 1494201600000
      }, {
        50: 999.9999999999999,
        95: 2099.999999999909,
        date: 1494288000000
      }, {
        50: 1000,
        95: 2000,
        date: 1494374400000
      }],
      num_running: 0
    }, {
      id: 'VNGCR_SQD_C1',
      last_execution: {
        stop_date: 1494438094000,
        success: true
      },
      last_granule_id: '2017130',
      success_ratio: {
        successes: 7162,
        total: 7162
      },
      ingest_perf: [{
        50: 2000,
        95: 4000,
        date: 1493856000000
      }, {
        50: 1000,
        95: 4000,
        date: 1493942400000
      }, {
        50: 1000,
        95: 4000,
        date: 1494028800000
      }, {
        50: 999.9999999999999,
        95: 4000,
        date: 1494115200000
      }, {
        50: 1000,
        95: 3000,
        date: 1494201600000
      }, {
        50: 1000,
        95: 3000,
        date: 1494288000000
      }, {
        50: 1000,
        95: 3000,
        date: 1494374400000
      }],
      num_running: 0
    }],
    name: 'VIIRS Ingest'
  }, {
    id: 'DiscoverMOPITT',
    success_ratio: {
      successes: 647,
      total: 647
    },
    ingest_perf: [{
      50: 2000,
      95: 4250,
      date: 1493856000000
    }, {
      50: 2000,
      95: 4000,
      date: 1493942400000
    }, {
      50: 2000,
      95: 4000,
      date: 1494028800000
    }, {
      50: 2000,
      95: 4000,
      date: 1494115200000
    }, {
      50: 2000,
      95: 4000,
      date: 1494201600000
    }, {
      50: 2000,
      95: 4000,
      date: 1494288000000
    }, {
      50: 2000,
      95: 4000,
      date: 1494374400000
    }],
    products: [{
      id: 'MOPITT_DCOSMR_LL_D_STD',
      last_execution: {
        stop_date: 1494437945000,
        success: true
      },
      success_ratio: {
        successes: 647,
        total: 647
      },
      ingest_perf: [{
        50: 2000,
        95: 4250,
        date: 1493856000000
      }, {
        50: 2000,
        95: 4000,
        date: 1493942400000
      }, {
        50: 2000,
        95: 4000,
        date: 1494028800000
      }, {
        50: 2000,
        95: 4000,
        date: 1494115200000
      }, {
        50: 2000,
        95: 4000,
        date: 1494201600000
      }, {
        50: 2000,
        95: 4000,
        date: 1494288000000
      }, {
        50: 2000,
        95: 4000,
        date: 1494374400000
      }],
      num_running: 0
    }],
    name: 'MOPITT Discovery'
  }, {
    id: 'IngestMOPITT',
    name: 'MOPITT Ingest',
    products: []
  }];

const getServiceStatusResp =
  [
    {
      service_name: 'GenerateMrf',
      desired_count: 2,
      running_tasks: [
        {
          started_at: '2017-05-23T11:40:34.729Z'
        }
      ]
    },
    {
      service_name: 'SfnScheduler',
      desired_count: 1,
      running_tasks: []
    },
    {
      service_name: 'OnEarth',
      desired_count: 3,
      running_tasks: [
        {
          started_at: '2017-05-17T15:09:46.169Z'
        },
        {
          started_at: '2017-05-17T15:09:52.604Z'
        },
        {
          started_at: '2017-05-17T15:09:48.299Z'
        }
      ]
    }
  ];


module.exports = { getWorkflowStatusResp, getServiceStatusResp };
