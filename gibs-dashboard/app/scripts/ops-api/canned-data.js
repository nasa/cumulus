'use strict';

/* eslint-disable max-len */

const getWorkflowStatusResp =
  [{
    id: 'DiscoverVIIRS',
    success_ratio: {
      successes: 1940,
      total: 1940
    },
    performance: [{
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
      performance: [{
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
      performance: [{
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
      performance: [{
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
    performance: [{
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
      performance: [{
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
      performance: [{
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
      performance: [{
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
    performance: [{
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
      performance: [{
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
  {
    services: [
      {
        service_name: 'GenerateMrf',
        desired_count: 2,
        events: [
          {
            id: '3ec891c4-cb83-4c49-bb16-3d1ab0c5f8eb',
            date: '2017-05-26T11:42:53.817Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'f7314a7f-a6ad-4d23-970a-e42c3d3c6475',
            date: '2017-05-26T11:42:41.523Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task f5749ecf-5a0b-453a-8424-f2d01c646f80) (task 863f1ba8-e72b-4720-b09a-bcb437d1852d).'
          },
          {
            id: 'd0e698c3-e22b-4863-b5c8-36c73b3f3b95',
            date: '2017-05-26T05:44:04.367Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'bfaa5ba3-6e1b-4964-ab84-d671f0679b71',
            date: '2017-05-25T23:43:38.583Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'c585d30a-47c6-42dc-b8b4-60b5c69baab5',
            date: '2017-05-25T17:43:10.704Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'a1aa2de1-9f00-4c49-b2f9-3d9c2f738723',
            date: '2017-05-25T11:42:48.963Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '12562f83-c27e-4e16-b330-d436248fefa0',
            date: '2017-05-25T05:42:27.096Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '81c92af4-b33f-4dcd-81a9-2b2b3dc82f1b',
            date: '2017-05-24T23:42:10.791Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '3339010c-de1f-4b09-9387-d041d5b9bfce',
            date: '2017-05-24T17:42:06.669Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '51eb13eb-93b5-44f9-a043-1d7ee6ba04a2',
            date: '2017-05-24T11:42:04.041Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'e55c7c53-a195-40f8-9a99-aa06768e0b4a',
            date: '2017-05-24T05:41:38.007Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '9b73a0e7-64d2-4f78-82e8-0a4af96e7de3',
            date: '2017-05-23T23:41:16.385Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '2973a9a7-bec1-4650-b313-b1327930f60d',
            date: '2017-05-23T17:41:02.167Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '3e99fd0c-ac70-432c-9ccf-2edc3ff2b9eb',
            date: '2017-05-23T11:40:40.786Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '96c86b08-ace6-4ebb-af68-33eb0b88a78b',
            date: '2017-05-23T11:40:29.291Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 06992d4f-39f0-4229-9142-fccd11701c51) (task 65c66b58-d003-4532-8bc7-e453c3ea8e24).'
          },
          {
            id: '51de1b61-a836-4d84-8ee0-9e26fa802c83',
            date: '2017-05-23T09:09:57.525Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '25dc6137-f0dc-422f-9c59-9569a724fb13',
            date: '2017-05-23T03:09:51.046Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'ba6d0eff-3262-462a-9b79-8201c24ee522',
            date: '2017-05-22T21:09:45.997Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '48810b22-8a09-4f53-947f-fb3de04a6dc9',
            date: '2017-05-22T15:09:36.183Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'fbf3a392-c5ee-4341-8789-ce7596069b04',
            date: '2017-05-22T15:09:24.659Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0e9888d1-95ed-412a-b35e-03c5fc46f2f7) (task 74f7bc12-fe94-4c0e-b1cd-c7005d3d9f70).'
          },
          {
            id: '3ce5f9e0-4fe4-449e-9604-2be2e3c0c65b',
            date: '2017-05-22T13:59:05.054Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'f072a55c-7617-43f1-a964-c271f0a2b84e',
            date: '2017-05-22T13:58:54.519Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 86e68560-d403-4b33-96e6-10cf98d4c8d9) (task e8c6ea26-4125-4290-a998-ee58b0fe65e9).'
          },
          {
            id: '12d0219b-9fef-4854-a2b3-89848931ae03',
            date: '2017-05-22T13:25:25.722Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'b00e4393-80ff-4427-bea5-0c1314f3860b',
            date: '2017-05-22T13:25:15.054Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 127077af-11ea-4839-a8b9-3f019032220f) (task 4323db48-b2a0-45c1-bde3-8d7d88f26631).'
          },
          {
            id: '402f2a25-80b9-4fa8-b663-2f27e8f38348',
            date: '2017-05-22T13:22:40.299Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'eacaf66f-26e5-43bc-96c1-49531a4cb0dd',
            date: '2017-05-22T13:22:27.410Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 1 tasks: (task 207b7170-48e6-4345-ac57-6ccb368a3174).'
          },
          {
            id: '26d55169-3c94-4fde-b701-2224996ab0a0',
            date: '2017-05-22T10:11:31.958Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'e67e2e19-42a0-47a6-aeff-29d41dccbc24',
            date: '2017-05-22T04:11:20.326Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'f8aa65e7-4d3c-4729-b0e9-23e8c056ce25',
            date: '2017-05-21T22:10:56.991Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'a43296eb-ccc9-4e75-aef1-c62d562fac78',
            date: '2017-05-21T22:10:44.895Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task c1c596cb-1a57-4231-9a6b-3472c52c9604) (task 435966d9-cbe1-43cb-ae22-ad661e33d5af).'
          },
          {
            id: 'bb6e6987-672b-40b0-a581-f6d47c302b43',
            date: '2017-05-21T21:14:59.337Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '3744cb8f-d522-478a-b311-12ddd68090cb',
            date: '2017-05-21T21:14:44.670Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2762cb1c-a29a-4b90-9595-5118ce9157d0) (task 527cb004-0f1b-41cd-8604-1fde29d3cb06).'
          },
          {
            id: '13b40f7f-2a5d-4582-8faf-127cf29bbf10',
            date: '2017-05-21T17:21:55.026Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '90cb9ec7-21a1-44fd-be0c-f966e57a4dcb',
            date: '2017-05-21T11:21:26.996Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'bf2c1878-7b41-4ef3-b3de-b3608e70d6cd',
            date: '2017-05-21T11:21:14.072Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task a488d043-1705-4e30-aed3-19889d032822) (task 763b92ac-d6f7-4987-8a00-83673dd15bf9).'
          },
          {
            id: '50c0e6fb-bd97-4c88-ac1d-1ca4c2e43f5c',
            date: '2017-05-21T10:56:50.861Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '4b59f6db-e996-4851-90ca-f18ae0a49b17',
            date: '2017-05-21T10:56:40.417Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 0a990536-328c-4a54-9a3d-07c03743ea85) (task 2c53cf0e-de4f-4012-8e02-3d164524c08f).'
          },
          {
            id: 'a5bd628e-6e22-4b68-9282-dbef97af8843',
            date: '2017-05-21T06:27:08.021Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '48d39de0-7ff0-4056-84db-4a071321bad3',
            date: '2017-05-21T00:27:02.706Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '689a5412-42ab-437a-b246-9634f2340da5',
            date: '2017-05-20T18:26:46.847Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '5aea07f0-637e-45d4-b7ac-5f8ccb7936f3',
            date: '2017-05-20T12:26:30.768Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '8a9d6a9a-801a-4a3d-a55c-b9d9539498a5',
            date: '2017-05-20T06:26:10.609Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: 'cb09444e-cdf9-4b92-86ca-8d63ac8c5a6f',
            date: '2017-05-20T00:26:07.994Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '1e621dff-9709-4a8f-b275-00e14e0d573f',
            date: '2017-05-19T18:25:52.970Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has reached a steady state.'
          },
          {
            id: '12b6462b-97c8-4a13-828c-ebd862bcf29b',
            date: '2017-05-19T18:24:36.134Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) has started 2 tasks: (task 2a269675-77ff-4250-a5dc-c8f517f5c2f2) (task 83ed912e-bc3e-400d-a615-1c68a59e81e5).'
          },
          {
            id: 'e3c4c37e-f971-4dca-9d7f-e85a03495a79',
            date: '2017-05-19T18:23:00.496Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-GenerateMrfService-HVFIZM5JLZCI) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.'
          }
        ],
        running_tasks: [
          {
            started_at: '2017-05-26T11:42:47.173Z'
          },
          {
            started_at: '2017-05-26T11:42:46.190Z'
          }
        ]
      },
      {
        service_name: 'SfnScheduler',
        desired_count: 1,
        events: [
          {
            id: '89ddefc5-21af-45c4-a9d9-dd0876436595',
            date: '2017-05-26T11:42:50.279Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '90843450-e9ed-4d77-aa26-4f1cdfce729c',
            date: '2017-05-26T11:42:37.585Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task cedbc61a-3c0b-44d9-8881-1411fddf2619).'
          },
          {
            id: '29d6c575-a768-4248-982c-eb4dabd9faaf',
            date: '2017-05-26T05:43:31.459Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '179c9ea6-3eee-4d9e-8f37-0bac4209aaad',
            date: '2017-05-25T23:43:29.459Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '5a0a3ecc-c276-471d-8374-fc6ca9f2ddd0',
            date: '2017-05-25T17:43:06.357Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '11bcb838-b9ec-4f63-9289-17da20081da0',
            date: '2017-05-25T11:43:04.409Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'c30c7500-e660-4e91-83c4-e3aad781b860',
            date: '2017-05-25T05:42:55.080Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'e4c71a32-9cea-4e0d-bb1c-9ff36abf6aac',
            date: '2017-05-24T23:42:37.578Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '38ffd1b5-324a-4f8c-bbec-01318b3f1db8',
            date: '2017-05-24T17:42:22.098Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '85407289-de31-4385-ad9e-7622081e1272',
            date: '2017-05-24T11:41:57.994Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '1f80425e-5ad4-440d-b218-60afc6794bfa',
            date: '2017-05-24T05:41:34.894Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '01157265-5487-411c-8503-e8a636b32f93',
            date: '2017-05-23T23:41:08.524Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'fe4170be-7366-4096-a42f-2824b512c1a4',
            date: '2017-05-23T17:40:52.851Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '586436b5-9d4e-466d-bbbb-f6d1d3dc5214',
            date: '2017-05-23T11:40:40.911Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '5a52d4ee-724e-46da-ab58-ab32516fee5f',
            date: '2017-05-23T11:40:29.708Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task 49435fa0-41cc-485b-940b-ccd6a08cb04e).'
          },
          {
            id: 'abadd5ac-c192-452f-8b8b-06ce9463da1f',
            date: '2017-05-23T09:10:24.759Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '967b6c94-8387-4615-867f-585cef8a726d',
            date: '2017-05-23T03:10:18.378Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '4550be4c-45b6-408b-95e5-a10e683b91a8',
            date: '2017-05-22T21:09:51.640Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'f1ac48eb-bfde-4ee2-8137-8b9670f2120e',
            date: '2017-05-22T15:09:37.015Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '62683e9e-2a3f-45de-b7e1-f407f96ec6bf',
            date: '2017-05-22T15:09:24.955Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task 5dc70934-4476-4e77-ae52-03c73ba5c270).'
          },
          {
            id: 'a6634bf0-a7bb-48fc-9911-c74c47b604a6',
            date: '2017-05-22T13:59:05.440Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '84592212-e1a3-4194-9dd9-a6044b07f8e8',
            date: '2017-05-22T13:58:54.796Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task 74c6ff15-5b1c-4531-8e63-d71f0d9b6823).'
          },
          {
            id: 'd71b7a3b-5ab2-4ba1-abf4-1411feed4c85',
            date: '2017-05-22T13:25:26.573Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '6cae5716-b7c8-4ee4-bc41-48606d90eb3f',
            date: '2017-05-22T13:25:15.395Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task 3652fa44-b9e4-4fe0-81a9-f0d04cb5fc70).'
          },
          {
            id: '7353354b-cbf3-40af-8186-d04a0a4aee46',
            date: '2017-05-22T10:32:49.440Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'fe98c48d-accf-47ae-8a11-1565fdca39a5',
            date: '2017-05-22T04:32:26.321Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '7e28275c-a4fe-4ec2-8df3-066e4c39b354',
            date: '2017-05-21T22:32:06.204Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '1c7bc69c-293b-4c5d-9b70-f642df9a628e',
            date: '2017-05-21T16:31:48.260Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '5a26c181-3b8d-4b46-be15-bc460038ae78',
            date: '2017-05-21T10:31:34.828Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '68799792-69c0-45c3-92c7-60e05a634eb8',
            date: '2017-05-21T10:31:23.637Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task b9d18322-0dc2-4968-bacf-497f7dc470f0).'
          },
          {
            id: 'c3b73752-9463-4308-ba49-aa33cb9a18c5',
            date: '2017-05-21T06:27:04.443Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'c5c5108b-dc2f-4628-ad5b-2a0aa5729328',
            date: '2017-05-21T00:26:54.683Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'f077021f-f3f3-4bc7-9a44-f6d745cb5ece',
            date: '2017-05-20T18:26:52.066Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '0dd1fe25-eeb4-45b7-8d51-df7f27c18b07',
            date: '2017-05-20T12:26:43.452Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'ee2d2da0-d226-4f88-a335-1f52163a3b3b',
            date: '2017-05-20T06:26:12.298Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '60a80f1d-1057-40e0-8025-321c582a4587',
            date: '2017-05-20T00:26:09.082Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: 'b2f78fc4-49f5-45cc-80cb-75ee62054c00',
            date: '2017-05-19T18:25:52.834Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has reached a steady state.'
          },
          {
            id: '56b8b70d-e426-4c86-ac0d-85c7eaabb9c0',
            date: '2017-05-19T18:24:36.806Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) has started 1 tasks: (task 7d7aa132-58bd-4b72-8dea-9f2130f8641f).'
          },
          {
            id: '739c811c-415f-4971-a9e9-fcec02d4329a',
            date: '2017-05-19T18:23:00.538Z',
            message: '(service gitc-jg-IngestStack-12UHWOQITAL9C-SfnSchedulerService-WRK734GZLNSY) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide.'
          }
        ],
        running_tasks: [
          {
            started_at: '2017-05-26T11:42:39.777Z'
          }
        ]
      },
      {
        service_name: 'OnEarth',
        desired_count: 3,
        events: [
          {
            id: '6c2434bc-97f6-4286-91a9-bf60a3848336',
            date: '2017-05-26T09:25:09.404Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'e25d41fd-d353-4316-b058-02b66e3b7417',
            date: '2017-05-26T03:24:42.109Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '21ea27ad-5d8c-463c-94e3-10bb40b462fa',
            date: '2017-05-25T21:24:14.461Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'c2e2ff82-5e70-41b9-abb1-73c3221a0b24',
            date: '2017-05-25T15:24:00.831Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'ae36e0f9-93ca-4dc3-a400-4aad299e6e9f',
            date: '2017-05-25T09:23:56.029Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '4ef15d58-ee74-481b-99d6-569cf5bfc644',
            date: '2017-05-25T03:23:20.295Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '349b1ea0-d2e0-4ed2-bd6d-026b1f7b4967',
            date: '2017-05-24T21:23:03.461Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '2b4babec-36d0-4bca-9e69-52d9b841e223',
            date: '2017-05-24T15:22:52.111Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'b1abef83-2b8d-4d72-bfe5-b42177dde24b',
            date: '2017-05-24T09:22:09.581Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'c59da16b-f2df-4107-b9b1-634d18d53d9e',
            date: '2017-05-24T03:21:47.049Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '6977f171-3d2d-48fe-be12-f62c7f2bf12a',
            date: '2017-05-23T21:21:32.781Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '2e0eca19-9384-4a76-b0fd-b1aa119c6e62',
            date: '2017-05-23T15:20:45.667Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '3e6f40a8-d865-4d48-9ae4-130dfcc25018',
            date: '2017-05-23T09:20:28.277Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '5aa0c9f4-7dd0-4951-a3b9-f486afcd611f',
            date: '2017-05-23T03:19:54.716Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '78678129-a267-4c73-9641-03c7ccb26e0f',
            date: '2017-05-22T21:19:43.558Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '459548c1-b7a1-47be-8da5-d4a18cfc2b4e',
            date: '2017-05-22T15:19:14.680Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '07fb6460-6008-4276-8826-eed7ef3923b5',
            date: '2017-05-22T09:19:07.305Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '7054e993-e1af-4133-92cb-69db590c7dc3',
            date: '2017-05-22T03:18:20.135Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '216b012f-29d6-4efc-9d92-21667329c148',
            date: '2017-05-21T21:17:36.196Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'fdf79211-6312-4411-b387-7e74b5591dab',
            date: '2017-05-21T15:17:14.780Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '7facece1-c420-46a2-a07b-30fcf958c03f',
            date: '2017-05-21T09:17:06.791Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '67b2c1db-9302-4ea6-9c5d-48db27d5a61c',
            date: '2017-05-21T03:16:27.500Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'ab4090d5-0af6-4185-a348-5504444401db',
            date: '2017-05-20T21:16:23.158Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: 'aba660e4-3ad0-41a6-aefd-1288e9f97223',
            date: '2017-05-20T15:16:18.348Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '515e708e-5839-461f-8a85-e81053c1c32f',
            date: '2017-05-20T09:15:49.717Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '3eb1d255-840a-41bc-ada1-a0949972d910',
            date: '2017-05-20T03:15:15.912Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '21541bf1-73cb-4f72-b69b-78492ba0e9b5',
            date: '2017-05-19T21:14:58.635Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '5eaa2896-c7ab-4fb8-b40c-a7a74bcaf4b9',
            date: '2017-05-19T15:14:40.225Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '044a4995-1ffc-4986-8285-6b5f6cb83942',
            date: '2017-05-19T09:13:53.600Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '908896e0-0b0b-446a-a10d-bf755e9b68f7',
            date: '2017-05-19T03:13:13.960Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '39b00eab-0973-457a-ae8f-2fa0ec071f47',
            date: '2017-05-18T21:12:30.878Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '9c31ee84-f7dd-42fe-8ea6-7188ba5fb152',
            date: '2017-05-18T15:12:05.183Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '444a8a02-9024-491c-b9d6-e516e8d29dff',
            date: '2017-05-18T09:11:28.937Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '14637f01-5246-4316-87f2-d142f48d4d48',
            date: '2017-05-18T03:11:25.368Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '96dba9ee-0358-4d9d-baa8-89bb4c92e908',
            date: '2017-05-17T21:10:57.242Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '5d588439-f270-4367-af50-f89699581527',
            date: '2017-05-17T15:10:16.663Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has reached a steady state.'
          },
          {
            id: '5205e54d-75d7-49d3-a53f-3851a757d1de',
            date: '2017-05-17T15:10:02.129Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) registered 1 targets in (target-group arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/gibs-oe-jg-onearth/ab7ed7f957e94345)'
          },
          {
            id: '464c4225-b895-4a4d-aed8-289147aaee2f',
            date: '2017-05-17T15:09:49.520Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) registered 2 targets in (target-group arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/gibs-oe-jg-onearth/ab7ed7f957e94345)'
          },
          {
            id: '61f80e6d-b261-4e18-afb1-d2dd986106d1',
            date: '2017-05-17T15:07:09.191Z',
            message: '(service gibs-oe-jg-OnEarthStack-1T6VC14DYLJQF-OnearthDocker-1KZF93BUB6VQ6-Service-19KQXSSV3CWKA) has started 3 tasks: (task 81524543-74d1-4d95-b455-7cff89088515) (task 9d78d227-9882-4302-8f9f-4deab64484c6) (task 07520087-779a-490d-bd69-34f1e4c12a66).'
          }
        ],
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
    ],
    connections: {
      MODAPS: {
        connection_limit: 50,
        used: 50
      },
      LARC: {
        connection_limit: 50,
        used: 0
      }
    }
  };

const getProductStatusResp =
  {
    running_executions: [
      {
        uuid: 'c0d98c30-67be-4e8a-98b0-1412af0d6750',
        start_date: '2017-06-07T06:22:40.312Z',
        granule_id: '2017158',
        current_state: 'MRFGen',
        reason: 'Timer'
      },
      {
        uuid: '0ddaf89d-b301-4797-9a42-4b4bd2729cca',
        start_date: '2017-05-27T07:42:41.860Z',
        granule_id: '2017147',
        current_state: 'MRFGen',
        reason: 'Timer'
      }
    ],
    completed_executions: [
      {
        uuid: '12b44f50-70e3-41dd-93b2-f90f44aa3771',
        start_date: '2017-06-08T17:37:52.000Z',
        stop_date: '2017-06-08T17:37:54.000Z',
        elapsed_ms: 2000,
        success: true,
        granule_id: '2017152',
        reason: 'Timer'
      },
      {
        uuid: '12b44f50-70e3-41dd-93b2-f90f44aa3771',
        start_date: '2017-06-08T17:37:52.000Z',
        stop_date: '2017-06-08T17:37:54.000Z',
        elapsed_ms: 2000,
        success: true,
        granule_id: '2017153',
        reason: 'Timer'
      },
      {
        uuid: '12b44f50-70e3-41dd-93b2-f90f44aa3771',
        start_date: '2017-06-08T17:37:52.000Z',
        stop_date: '2017-06-08T17:37:53.000Z',
        elapsed_ms: 1000,
        success: true,
        granule_id: '2017154',
        reason: 'Timer'
      },
      {
        uuid: '12b44f50-70e3-41dd-93b2-f90f44aa3771',
        start_date: '2017-06-08T17:37:52.000Z',
        stop_date: '2017-06-08T17:37:53.000Z',
        elapsed_ms: 1000,
        success: true,
        granule_id: '2017151',
        reason: 'Timer'
      },
      {
        uuid: '12b44f50-70e3-41dd-93b2-f90f44aa3771',
        start_date: '2017-06-08T17:37:52.000Z',
        stop_date: '2017-06-08T17:37:53.000Z',
        elapsed_ms: 1000,
        success: true,
        granule_id: '2017148',
        reason: 'Timer'
      }
    ],
    performance: [
      {
        50: 1000,
        95: 2000,
        date: 1496275200000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496361600000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496448000000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496534400000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496620800000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496707200000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496793600000
      },
      {
        50: 1000,
        95: 2000,
        date: 1496880000000
      }
    ]
  };


module.exports = { getWorkflowStatusResp, getServiceStatusResp, getProductStatusResp };
