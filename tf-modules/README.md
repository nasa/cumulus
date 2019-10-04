# Terraform modules

This directory contains all of the [Terraform modules](https://www.terraform.io/docs/modules/index.html) maintained as part of a Cumulus deployment.

These modules are assembled to create a Cumulus deployment, which gives integrators the flexibility to choose only the components of Cumulus that they need or want. A reference implementation for a "full" deployment of Cumulus exists in the [`example/cumulus-tf` folder](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf).

## Creating a new module

To add a new Terraform module:

1. Create a new directory in this `tf-modules` directory.
    - Make sure to copy the `.gitignore` from one of the existing modules
2. Add `.tf` files specifying the resources that should be included for your module.
3. Define any variables that will be needed for your resources in a `variables.tf` file. See [Terraform documentation on input variables](https://www.terraform.io/docs/configuration/variables.html).
4. If resources defined by your module will need to be referenced by other modules, then include an `outputs.tf` which defines outputs that can be referenced by other Terraform modules/resources. See the [Terraform documentation on output values](https://www.terraform.io/docs/configuration/outputs.html) and [an example for the `data-persistence` module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence/outputs.tf).
5. Add a `terraform.tfvars.sample` file showing sample values for the input variables supported by your module
6. Add a `README.md` which, at minimum, documents:
    - What is included in the module
    - How to deploy it
    - Description of the variables necessary to configure the module

## Integrating a module as a submodule

To include a module as a submodule:

1. Add any variables necessary to support the child module to the parent module's `variables.tf` file so that variables can be passed through the parent module into the child module
    - Update the parent module's `terraform.tfvars.sample` file to reflect any new variables
2. Add or update a `.tf` file in the parent module to include the child module. Pass through the necessary variables from the parent module to the child module.
3. If necessary, add any outputs from the child module that should also be output from the parent module to the parent module's `outputs.tf` file

### Integrating a submodule with the Cumulus module

The Cumulus module includes all of the resources and submodules that provide Cumulus functionality. It provides a Terraform module for integrators who want an "off the shelf" version of all Cumulus functionality.

Follow the steps above to add a submodule to the Cumulus module.

## Integrating a submodule with the example Cumulus deployment

If you have already added your module to the [Cumulus module](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus), then it will automatically be included in the [example Cumulus deployment](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf).

If your module should not be included in the Cumulus module, for example if it is not providing default Cumulus functionality, then add or update `.tf` in the example Cumulus deployment to include it.
