# @cumulus/orca-recovery-adapter

This is a [Cumulus](https://nasa.github.io/cumulus) task which acts as an adapter of ORCA recovery workflow.
It will take input cumulus message, build a list of Cumulus granule objects and granule
collection configuration, call the ORCA recovery step-function, and return result, raising errors as appropriate.
This provides an injection seam to contact the ORCA recovery step-function with ORCA's formatting.

## Message Configuration

For more information on configuring a Cumulus Message Adapter task, see
[the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please see our
[contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
