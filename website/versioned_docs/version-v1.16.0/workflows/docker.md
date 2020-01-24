---
id: version-v1.16.0-docker
title: Dockerizing Data Processing
hide_title: true
original_id: docker
---

# Dockerizing Data Processing

The software used for processing data amongst DAAC's is developed in a variety of languages, and with different sets of dependencies and build environments. To standardize processing, Docker allows us to provide an environment (called an image) to meet the needs of any processing software, while running on the kernel of the host server (in this case, an EC2 instance). This lightweight virtualization does not carry the overhead of any additional VM, providing near-instant startup and the ability to run any dockerized process as a command-line call.

## Using Docker

Docker images are run using the `docker` command and can be used to build a Docker image from a Dockerfile, fetch an existing image from a remote repository, or run an existing image. In Cumulus, `docker-compose` is used to help developers by making it easy to build images locally and test them.

To run a command using docker-compose use:

```bash
docker-compose run *command*
```

where *commmand* is one of

* *build*: Build and tag the image using the Dockerfile
* *bash*: Run the Dockerfile interatively (via a bash shell)
* *test*: Processes data in the directory *data/input* and saves the output to the *data/test-output* directory. These directories must exist.

### The Docker Registry

Docker images that are built can be stored in the cloud in a Docker registry. Currently we are using the AWS Docker Registry, called ECR. To access these images, you must first log in using your AWS credentials, and use AWS CLI to get the proper login string:

```bash
# install awscli
pip install awscli

# login to the AWS Docker registry
aws ecr get-login --region us-east-1 | source /dev/stdin
```

As long as you have permissions to access the NASA Cumulus AWS account, this will allow you to pull images from AWS ECR, and push rebuilt or new images there as well. Docker-compose may also be used to push images.

```bash
docker-compose push
```

Which will push the built image to AWS ECR. Note that the image built by docker-compose will have is the `:latest` tag, and will overwrite the `:latest` tagged docker image on the registry.  This file should be updated to push to a different tag if overwriting is not desired.

In normal use-cases for most production images on either repository,  CircleCI takes care of this building and deploying process

### Source Control and Versions

All the code necessary for processing a data collection, and the code used to create a Docker image for it, is contained within a single GitHub repository, following the naming convention `docker-${dataname}`, where `dataname` is the collection's short name. The git `develop` branch is the current development version, `master` is the latest release version, and a git tag exists for each tagged version (e.g., `v0.1.3`).

Docker images can have multiple tagged versions. The Docker images in the registry follow this same convention. A Docker image tagged as 'develop' is an image of the development branch. 'latest' is the master brach, and thus the latest tagged version, with an additional tagged image for each version tagged in the git repository.

The generation of the released tagged images are created and deployed automatically with Circle-CI, the continuous integration system used by Cumulus. When new commits are merged into a branch, the appropriate Docker image is built, tested, and deployed to the Docker registry. More on testing below.

## Docker Images

### docker-base

Docker images are built in layers, allowing common dependencies to be shared to child Docker images. A base docker image is provided that includes some dependencies shared among the current HS3 data processing codes. This includes NetCDF liraries, AWS Cli, Python, Git, as well as py-cumulus, a collection of Python utilities that are used in the processing scripts. The docker-base repository is used to generate new images that are then stored in AWS ECR.

The docker-base image can be interacted with by running it in interactive mode (ie, `docker run -it docker-base`, since the default "entrypoint" to the image is a bash shell.

### docker-data example: docker-hs3-avaps

To create a new processing stream for a data collection, a Dockerfile is used to specify what additional dependencies may be required, and to build them in that environment, if necessary. An example Dockerfile is shown here, for the hs3avaps collection.

```bash
# cumulus processing Dockerfile: docker-hs3-avaps

FROM 000000000000.dkr.ecr.us-east-1.amazonaws.com/cumulus-base:latest

# copy needed files
WORKDIR /work
COPY . /work

RUN apt-get install -y nco libhdf5-dev

# compile code
RUN gcc convert/hs3cpl2nc.c -o _convert -I/usr/include/hdf5/serial -L/usr/include/x86_64-linux-gnu -lnetcdf -lhdf5_serial

# input and output directories will be Data Pipeline staging dir env vars
ENTRYPOINT ["/work/process.py"]
CMD ["input", "output"]
```

When this Dockerfile is built, docker will first use the latest cumulus-base image. It will then copy the entire GitHub repository (the processing required for a single data collection is a repository) to the `/work` directory which will now contain all the code necessary to process this data. In thie case, a C file is compiled to convert the supplied hdf5 files to NetCDF files. Note that this also requires installing the system libraries `nco` and `libhdf5-dev` via `apt-get`. Lastly, the Dockerfile sets the entrypoint to the processing handler, so that this command is run when the image is run. It expects two arguments to be handed to it: 'input' and 'output' meaning the input and output directories.

## Process Handler

All of the processing is managed through a handler, which is called when the docker image is run. Currently, Python is used for the process handler, which provides a simple interface to perform validation, run shell commands, test the output generated, and log the output for us. The handler function takes two arguments: input directory and output directory. Any other needed parameters are set via environment variables. The handler function will process the input directory, and put any output to be saved in the output directory.

### Py-cumulus

The py-cumulus library provides some helper functions that can be used for logging, writing metadata, and testing. Py-cumulus is installed in the docker-base image. Currently, there are three modules:

```python
import cumulus.logutils
import cumulus.metadata
import cumulus.process
```

### Example process handler

An example process handler is given here, in this case a shortened version of the hs3-cpl data collection. The main function at the bottom passes the provided input and output directory arguments to the process() function. The first thing process() does is to get the Cumulus logger. The Cumulus logger will send output to both stdout and Splunk, to be used in the Cumulus pipeline. Log strings are made using the make_log_string() function which properly formats a message to be handled by Splunk.

```python
#!/usr/bin/env python

import os
import sys
import glob
import re
import datetime
import subprocess
from cumulus.logutils import get_logger, make_log_string
from cumulus.metadata import write_metadata
from cumulus.process import check_output

# the main process handler
def process(indir, outdir):
    """ Process this directory """
    log = get_logger()
    log.info(
        make_log_string(process='processing', message="Processing %s into %s" % (indir, outdir))
    )

    dataname = 'cpl'
    dataid = os.getenv('SHORT_NAME', 'hs3cpl')

    for f in glob.glob(os.path.join(indir, '*.hdf5')):
        bname = os.path.basename(f)
        log.info(
            make_log_string(granule_id=bname, process='processing', message="Processing started for %s" % bname)
        )

        # convert file to netcdf
        cmd = ['/work/_convert', f, outdir]
        out = subprocess.check_output(cmd)
        fout = glob.glob(os.path.join(outdir, 'HS3_%s*.nc' % bname[0:7]))
        fout = '' if len(fout) == 0 else fout[0]
        check_output(fout)
        cmd = ['ncatted -h -a Conventions,global,c,c,"CF-1.6" %s' % fout]
        out = subprocess.check_output(cmd, shell=True)
        log.debug(out)

        # write metadata output
        write_metadata(fout, dataname=dataname, dataid=dataid, outdir=outdir)

    # remove the generated metadata files
    for f in glob.glob(os.path.join(outdir, '*.met')):
        os.remove(f)

if __name__ == "__main__":
    indir = sys.argv[1]
    outdir = sys.argv[2]
    process(indir, outdir)

```

After setting up logging the code has a for-loop for processing any matching hdf5 in the input directory:

1) convert to NetCDF with a C script
2) validate the output (in this case just check for existence)
3) use 'ncatted' to update the resulting file to be CF-compliant
4) write out metadata generated for this file

## Process Testing

It is important to have tests for data processing, however in many cases datafiles can be large so it is not practical to store the test data in the repository. Instead, test data is currrently stored on AWS S3, and can be retrieved using the AWS CLI.

```bash
aws s3 sync s3://cumulus-ghrc-logs/sample-data/collection-name data
```

Where collection-name is the name of the data collection, such as 'avaps', or 'cpl'.  For example, an abridged version of the data for CPL includes:

```txt
├── cpl
│   ├── input
│   │   ├── HS3_CPL_ATB_12203a_20120906.hdf5
│   │   ├── HS3_CPL_OP_12203a_20120906.hdf5
│   └── output
│       ├── HS3_CPL_ATB_12203a_20120906.nc
│       ├── HS3_CPL_ATB_12203a_20120906.nc.meta.xml
│       ├── HS3_CPL_OP_12203a_20120906.nc
│       ├── HS3_CPL_OP_12203a_20120906.nc.meta.xml
```

Contained in the input directory are all possible sets of data files, while the output directory is the expected result of processing. In this case the hdf5 files are converted to NetCDF files and XML metadata files are generated.

The docker image for a process can be used on the retrieved test data. First create a test-output directory in the newly created data directory.

```bash
mkdir data/test-output
```

Then run the docker image using docker-compose.

```bash
docker-compose run test
```

This will process the data in the data/input directory and put the output into data/test-output. Repositories also include Python based tests which will validate this newly created output to the contents of data/output. Use Python's Nose tool to run the included tests.

```bash
nosetests
```

If the data/test-output directory validated against the contents of data/output the tests will be successful, otherwise an error will be reported.
