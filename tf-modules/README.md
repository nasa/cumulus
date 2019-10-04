# Terraform modules

This directory contains all of the [Terraform modules](https://www.terraform.io/docs/modules/index.html) maintained as part of a Cumulus deployment.

These modules are assembled to create a Cumulus deployment, which allows integrators the flexibility to choose only the components of Cumulus that they need or want. A reference implementation for a "full" deployment of Cumulus exists in the [`example/cumulus-tf` folder](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf).

## Creating a new module

To add a new Terraform module:

1. Create a new directory in this `tf-modules` directory
2. Add `.tf` files specifying the resources that should be included for your module
3. Define any variables that will be needed for your resources in a `variables.tf` file
4. If resources defined by your module will need to be referenced by other modules, then include an `outputs.tf` which defines outputs that can be referenced by other Terraform modules/resources. [See an example for the `data-persistence` module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence/outputs.tf).
