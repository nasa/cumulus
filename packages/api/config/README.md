# cumulus-api configuration

This folder includes the configuration needed to deploy cumulus-api using [Kes](https://github.com/developmentseed/kes).

## Api Endpoints

The lambda functions and the api endpoints used by AWS ApiGateway service are stored in `api_default.yml` and `api_v1.yaml`. Each file represents a version of cumulus-api.

## Api Distribution App

The lambda function and the api endpoints used by AWS ApiGateway service are stored in `distribution.yml` for the distribution app. The distribution app is used for putting objects on S3 behind a [EarthLogin](https://urs.earthdata.nasa.gov/documentation) authentication.

## Api Lambdas

All lambda functions that are used by the cumulus-api but are not associated with an ApiGateway endpoint are configured in `lambdas.yml`