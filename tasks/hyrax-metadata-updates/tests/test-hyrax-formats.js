'use strict';

const test = require('ava');

const rewire = require('rewire');
const HyraxMetadataUpdate = rewire('../index');

const isAppropriateForHyrax = HyraxMetadataUpdate.__get__('isAppropriateForHyrax');

test.beforeEach((t) => {
  t.context.event = {
    config: {
      cmr: {
        oauthProvider: 'earthdata',
        provider: 'GES_DISC',
        clientId: 'xxxxxx',
        username: 'xxxxxx',
        passwordSecretName: 'xxxxx'
      }
    },
    input: {}
  };
  t.context.goodFormats = [
    'HDF-5',
    'NETCDF-4'
  ];

  t.context.baseUmmGGranule = {
    GranuleUR: 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4',
    CollectionReference: {
      ShortName: 'GLDAS_CLSM025_D',
      Version: '2.0'
    },
    DataGranule: {
      ArchiveAndDistributionInformation: [
        {
          Name: 'GranuleZipFile',
          SizeInBytes: 23000,
          Size: 23,
          SizeUnit: 'KB',
          Format: 'HDF5',
          MimeType: 'foo',
          Checksum: {
            Value: 'E51569BF48DD0FD0640C6503A46D4753',
            Algorithm: 'MD5'
          }
        }
      ]
    }
  };

  t.context.baseEcho10Granule = {
    Granule: {
      GranuleUR: 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4',
      Collection: {
        ShortName: 'GLDAS_CLSM025_D',
        VersionId: '2.0'
      },
      OnlineAccessURLs: {
        OnlineAccessURL: {
          URL: 'https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_CLSM025_D.2.0/2014/12/GLDAS_CLSM025_D.A20141230.020.nc4'
        }
      },
      Orderable: false
    }
  };
});

test('if no hyrax config exists then the granule is appropriate for Hyrax (ECHO10)', (t) => {
  const actual = isAppropriateForHyrax(t.context.event.config, {}, false);
  t.is(actual, true);
});

test('if partial hyrax config exists then the granule is appropriate for Hyrax (ECHO10)', (t) => {
  t.context.event.config.hyrax = {};
  const actual = isAppropriateForHyrax(t.context.event.config, {}, false);
  t.is(actual, true);
});

test('if no hyrax config exists then the granule is appropriate for Hyrax (UMM-G)', (t) => {
  const actual = isAppropriateForHyrax(t.context.event.config, {}, true);
  t.is(actual, true);
});

test('if partial hyrax config exists then the granule is appropriate for Hyrax (UMM-G)', (t) => {
  t.context.event.config.hyrax = {};
  const actual = isAppropriateForHyrax(t.context.event.config, {}, true);
  t.is(actual, true);
});

test('if full hyrax config exists and formats match then the granule is appropriate for Hyrax (UMM-G)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };
  const appropriateUmmGGranule = t.context.baseUmmGGranule;
  appropriateUmmGGranule.DataGranule.ArchiveAndDistributionInformation[0].Format = 'HDF-5';
  const actual = isAppropriateForHyrax(t.context.event.config, appropriateUmmGGranule, true);
  t.is(actual, true);
});

test('if full hyrax config exists and formats do not match then the granule is not appropriate for Hyrax (UMM-G)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };
  const innappropriateUmmGGranule = t.context.baseUmmGGranule;
  innappropriateUmmGGranule.DataGranule.ArchiveAndDistributionInformation[0].Format = 'ASCII';
  const actual = isAppropriateForHyrax(t.context.event.config, innappropriateUmmGGranule, true);
  t.is(actual, false);
});

test('if full hyrax config exists and formats cannot be found in the granule then it is not appropriate for Hyrax (UMM-G)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };

  const poorUmmGGranule = {
    GranuleUR: 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4',
    CollectionReference: {
      ShortName: 'GLDAS_CLSM025_D',
      Version: '2.0'
    },
    DataGranule: {
    }
  };
  const actual = isAppropriateForHyrax(t.context.event.config, poorUmmGGranule, true);
  t.is(actual, false);
});

test('if full hyrax config exists and formats match then the granule is appropriate for Hyrax (ECHO10)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };
  const appropriateEcho10Granule = t.context.baseEcho10Granule;
  appropriateEcho10Granule.Granule.DataFormat = 'NETCDF-4';
  const actual = isAppropriateForHyrax(t.context.event.config, appropriateEcho10Granule, false);
  t.is(actual, true);
});

test('if full hyrax config exists and formats do not match then the granule is not appropriate for Hyrax (ECHO10)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };
  const innappropriateEcho10Granule = t.context.baseEcho10Granule;
  innappropriateEcho10Granule.Granule.DataFormat = 'ASCII';
  const actual = isAppropriateForHyrax(t.context.event.config, innappropriateEcho10Granule, false);
  t.is(actual, false);
});

test('if full hyrax config exists and formats cannot be found in the granule then it is not appropriate for Hyrax (ECHO10)', (t) => {
  t.context.event.config.hyrax = {
    formats: t.context.goodFormats
  };
  const actual = isAppropriateForHyrax(t.context.event.config, t.context.baseEcho10Granule, false);
  t.is(actual, false);
});
