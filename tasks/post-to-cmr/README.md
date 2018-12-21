# @cumulus/post-to-cmr

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

This lambda function is responsible for posting the CMR metadata of a given granule.

It will use the information contained in a metadata file on S3 and post that information to [CMR (Common Metadata Repository)](https://cmr.earthdata.nasa.gov/search/).
The S3 metadata file can be either `ECHO10 xml` metadata with extension `.cmr.xml` or `UMM-G JSON` with extension `.cmr.json`.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
