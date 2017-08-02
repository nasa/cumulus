# SIPS Handler Prototype

This package prototypes the various steps involved in ingesting data from a SIPS service.
* Retrieving PDRs from the service
* Parsing PDRs
* Retrieving referenced archive files.
* Error handling to generate and upload PDRDs when parsing PDRs fails
* Error handling to generate and upload PAN files when processing archive files fails.

## Running the Prototype

This project depends on [PVL.js](https://github.com/cumulus-nasa/pvl), the NASA/Cumulus package
for parsing Parameter Value Language (the language of PDRs). The easiest way to provide this
is to clone the git repository for that project and create an npm link into this project as follows:

``` bash
git clone https://github.com/cumulus-nasa/pvl.git
cd pvl
npm link
cd <the directory containing this README.md>
npm link pvl
```

The prototype follows the basic project structure of a Cumulus task. The primary entry points
are `run` and `handler` (for AWS Lambda). Only the `run` entry point has been tested for this
prototype, no Lambda deployment has been done as yet.
