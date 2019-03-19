# @cumulus/post-to-cmr

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

This lambda function posts granule metadata to [CMR (Common Metadata Repository)](https://cmr.earthdata.nasa.gov/search/).

It will use the information contained in a metadata file on S3 and post that information to the CMR service.
The S3 metadata file can be either `ECHO10 xml` metadata with extension `.cmr.xml` or `UMM-G JSON` with extension `.cmr.json`.

## What metadata fields will cumulus update and manage?

The `move-granules` task and the `(api)granules.move` function will both update the metadata files on S3. For UMM-G JSON metadata, `RelatedUrls` are updated, while ECHO10 XML metadata will maintain the metadata in `OnlineAccessURLs`.

A granule's files URL, and Type/Description for UMMG and URLDescription for ECHO10, are modified for each file in the granule based on its bucket location. The metadata URLs are based on the file bucket storage type.  Files placed in protected buckets will get a url to the distribution endpoint. Files in public buckets will get direct `https` links. URLs not directly related to the granule's files are unmodified and preserved as they exist.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| bucket | string | (required) | Name of S3 bucket containing public/private key pair to decrypt CMR credentials
| process | string | (required) | Process the granules went through
| stack | string | (required) | Name of deployment stack
| cmr | object | (required) | CMR credentials object

### Input

Input object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| granules | array\<object\> | (required) | List of granule objects

### Output

Output object fields:

| field name | type | default | values | description
| ---------- | ---- | ------- | ------ | -----------
| granules | array\<object\> | N/A | List of granule objects published to CMR
| process | string | N/A | Process the granules went through


## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)
