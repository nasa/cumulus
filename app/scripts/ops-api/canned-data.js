'use strict';

const getWorkflowStatusResp =
  [
    {
      id: 'DiscoverVIIRS',
      name: 'VIIRS Discovery',
      executions: [
        {
          status: 'RUNNING',
          start_date: '2017-04-27T13:37:10.379Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:27:55.650Z',
          stop_date: '2017-04-27T13:28:15.656Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:22:10.334Z',
          stop_date: '2017-04-27T13:25:35.161Z'
        }
      ]
    },
    {
      id: 'IngestVIIRS',
      name: 'VIIRS Ingest',
      executions: [
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:28:15.418Z',
          stop_date: '2017-04-27T13:28:17.276Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:28:15.421Z',
          stop_date: '2017-04-27T13:28:17.171Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:28:15.451Z',
          stop_date: '2017-04-27T13:28:16.865Z'
        }
      ]
    },
    {
      id: 'DiscoverMOPITT',
      name: 'MOPITT Discovery',
      executions: [
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:37:10.364Z',
          stop_date: '2017-04-27T13:37:12.146Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:22:10.319Z',
          stop_date: '2017-04-27T13:22:12.456Z'
        },
        {
          status: 'SUCCEEDED',
          start_date: '2017-04-27T13:07:10.397Z',
          stop_date: '2017-04-27T13:07:12.473Z'
        }
      ]
    },
    {
      id: 'IngestMOPITT',
      name: 'MOPITT Ingest',
      executions: []
    }
  ];

module.exports = { getWorkflowStatusResp };
