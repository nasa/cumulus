'use strict';

const test = require('ava');
const index = require('..');

test('buildMetricDataObject() returns the correct metric data objects', (t) => {
  const logEvents = [
    {
      httpStatus: 200,
      operation: 'REST.GET.VERSIONING',
      timestamp: 1549411200
    }
  ];

  const metricDataObject = index.buildMetricDataObject(
    'MyMetricName',
    'my-stack',
    logEvents
  );

  t.is(metricDataObject.MetricName, 'MyMetricName');
  t.deepEqual(metricDataObject.Dimensions, [{ Name: 'Stack', Value: 'my-stack' }]);
  t.is(metricDataObject.Timestamp, '2019-02-06T00:00:00.000Z');
  t.is(metricDataObject.Value, 1);
});

test('getHttpStatusFromLogLine() returns the HTTP status of the log event', (t) => {
  const logLine = '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1';

  t.is(index.getHttpStatusFromLogLine(logLine), 200);
});

test('getOperationFromLogLine() returns the S3 operation of the log event', (t) => {
  const logLine = '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1';

  t.is(index.getOperationFromLogLine(logLine), 'REST.GET.VERSIONING');
});

test('getFailureMetricDataObjects() returns the expected result', (t) => {
  const logEvents = [
    // Should be included in period 1
    { timestamp: 1549411200, httpStatus: 404, operation: 'REST.GET.OBJECT' },

    // Should not be included because the status is 200
    { timestamp: 1549411200, httpStatus: 200, operation: 'REST.GET.OBJECT' },

    // Should be included in period 1
    { timestamp: 1549411200, httpStatus: 500, operation: 'REST.GET.OBJECT' },

    // Should be included in period 2
    { timestamp: 1549411260, httpStatus: 400, operation: 'REST.GET.OBJECT' }
  ];

  const metricDataObjects = index.getFailureMetricDataObjects(
    'my-stack',
    logEvents
  );

  t.is(metricDataObjects.length, 2);

  const firstPeriod = metricDataObjects.find(
    (o) => o.Timestamp === '2019-02-06T00:00:00.000Z'
  );
  console.log(JSON.stringify(firstPeriod));
  t.not(firstPeriod, undefined);
  t.is(firstPeriod.MetricName, 'FailureCount');
  t.is(firstPeriod.Value, 2);

  const secondPeriod = metricDataObjects.find(
    (o) => o.Timestamp === '2019-02-06T00:01:00.000Z'
  );
  t.not(secondPeriod, undefined);
  t.is(secondPeriod.MetricName, 'FailureCount');
  t.is(secondPeriod.Value, 1);
});

test('getSuccessMetricDataObjects() returns the expected result', (t) => {
  const logEvents = [
    // Should be included in period 1
    { timestamp: 1549411200, httpStatus: 200, operation: 'REST.GET.OBJECT' },

    // Should not be included because the status is not 200
    { timestamp: 1549411200, httpStatus: 500, operation: 'REST.GET.OBJECT' },

    // Should be included in period 1
    { timestamp: 1549411200, httpStatus: 200, operation: 'REST.GET.OBJECT' },

    // Should be included in period 2
    { timestamp: 1549411260, httpStatus: 200, operation: 'REST.GET.OBJECT' }
  ];

  const metricDataObjects = index.getSuccessMetricDataObjects(
    'my-stack',
    logEvents
  );

  t.is(metricDataObjects.length, 2);

  const firstPeriod = metricDataObjects.find(
    (o) => o.Timestamp === '2019-02-06T00:00:00.000Z'
  );
  console.log(JSON.stringify(firstPeriod));
  t.not(firstPeriod, undefined);
  t.is(firstPeriod.MetricName, 'SuccessCount');
  t.is(firstPeriod.Value, 2);

  const secondPeriod = metricDataObjects.find(
    (o) => o.Timestamp === '2019-02-06T00:01:00.000Z'
  );
  t.not(secondPeriod, undefined);
  t.is(secondPeriod.MetricName, 'SuccessCount');
  t.is(secondPeriod.Value, 1);
});

test('getTimestampFromLogLine() returns the timestamp of the log event', (t) => {
  const logLine = '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1';

  t.is(index.getTimestampFromLogLine(logLine), 1549411200);
});

test('getTimestampFromLogLine() rounds down to the nearest minute', (t) => {
  const logLine = '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:12 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1';

  t.is(index.getTimestampFromLogLine(logLine), 1549411200);
});

test('logLineToLogEvent() returns the correct log event', (t) => {
  const logLine = '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.VERSIONING - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1';

  t.deepEqual(
    index.logLineToLogEvent(logLine),
    {
      httpStatus: 200,
      operation: 'REST.GET.VERSIONING',
      timestamp: 1549411200
    }
  );
});

test('metricDataObjectsFromAccessLog() returns the expected metric data objects', (t) => {
  const accessLog = `
79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.OBJECT - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1
79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.PUT.OBJECT - "GET /awsexamplebucket?versioning HTTP/1.1" 200 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1
79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be awsexamplebucket [06/Feb/2019:00:00:00 +0000] 192.0.2.3 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be 3E57427F3EXAMPLE REST.GET.OBJECT - "GET /awsexamplebucket?versioning HTTP/1.1" 400 - 113 - 7 - "-" "S3Console/0.4" - s9lzHYrFp76ZVxRcpX9+5cjAnEH2ROuNkd2BHfIa6UkFVdtjf5mKR3/eTPFvsiP/XV/VLi31234= SigV2 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader awsexamplebucket.s3.amazonaws.com TLSV1.1
`.trim();

  const result = index.metricDataObjectsFromAccessLog('my-stack', accessLog);

  t.is(result.length, 2);
  t.is(result.filter((o) => o.MetricName === 'SuccessCount').length, 1);
  t.is(result.filter((o) => o.MetricName === 'FailureCount').length, 1);
});

test('s3ParamsFromRecord() returns the correct Bucket and Key', (t) => {
  const record = {
    s3: {
      bucket: {
        name: 'my-bucket'
      },
      object: {
        key: 'my-key'
      }
    }
  };

  t.deepEqual(
    index.s3ParamsFromRecord(record),
    { Bucket: 'my-bucket', Key: 'my-key' },
  );
});
