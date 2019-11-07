# Terraform modules

This directory contains all of the [Terraform modules](https://www.terraform.io/docs/modules/index.html) maintained as part of a Cumulus deployment.

These modules are composed to create a Cumulus deployment, which gives integrators the flexibility to choose only the components of Cumulus that they need or want. A reference implementation for a "full" deployment of Cumulus exists in the [`example/cumulus-tf` folder](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf).

## Creating a new module

To add a new Terraform module:

1. Create a new directory in this `tf-modules` directory.
    - Make sure to copy the `.gitignore` from one of the existing modules
2. Add `.tf` files specifying the resources that should be included for your module.
3. Define any variables that will be needed for your resources in a `variables.tf` file. See [Terraform documentation on input variables](https://www.terraform.io/docs/configuration/variables.html). Variables should include a `description` documenting their purpose.
4. If resources defined by your module will need to be referenced by other modules, then include an `outputs.tf` which defines outputs that can be referenced by other Terraform modules/resources. See the [Terraform documentation on output values](https://www.terraform.io/docs/configuration/outputs.html) and [an example for the `data-persistence` module](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence/outputs.tf).
5. Add a `terraform.tfvars.sample` file showing sample values for the input variables supported by your module
6. Add a `README.md` which, at minimum, documents:
    - What is included in the module
    - An example of how to deploy it
    - Any additional context for the input variables of this module

## Testing deployment of your module

If you want to test deploying your module by itself, you can follow these steps:

1. Run `terraform init` (it is only necessary to do this before the first deployment)
2. Copy `terraform.tfvars.sample` to `terraform.tfvars`, replacing the sample values with the correct values for your environment
3. Deploy your module: `terraform apply`

## Integrating a module as a submodule

To include a module as a submodule:

1. Add any variables necessary to support the submodule to the parent module's `variables.tf` file so that variables can be passed through the parent module into the submodule
    - Update the parent module's `terraform.tfvars.sample` file to reflect any new variables
2. Add or update a `.tf` file in the parent module to include the submodule. Pass through the necessary variables from the parent module to the submodule.
3. If necessary, add any outputs from the submodule that should also be output from the parent module to the parent module's `outputs.tf` file

### Integrating a submodule with the Cumulus module

The Cumulus module includes all of the resources and submodules that provide Cumulus functionality. It provides a Terraform module for integrators who want an "off the shelf" version of all Cumulus functionality.

Follow the steps above to add a submodule to the Cumulus module.

### Integrating a submodule with the example Cumulus deployment

If you have already added a submodule to the [Cumulus module](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus), then it will automatically be included in the [example Cumulus deployment](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf).

If the module should not be included in the Cumulus module, for example if it is not providing core Cumulus functionality, then follow the steps above to include it directly as a submodule in the example Cumulus deployment.

## Integrating a module into the CI/CD pipeline

If the module has been integrated into the Cumulus module or the example Cumulus deployment as a submodule, then it will already be integrated into the Terraform deployment managed by the CI/CD pipeline.

If the module is a standalone module that should not be integrated as a submodule (e.g. [`data-persistence`](https://github.com/nasa/cumulus/blob/master/tf-modules/data-persistence/outputs.tf)), then you will need to follow these steps to include it in the CI/CD pipeline:

1. Add a reference implementation for using your module in the `example` directory. See the [reference implementation for the `data-persistence` module](https://github.com/nasa/cumulus/blob/master/example/data-persistence-tf).
    - Make sure to include a [`provider` configuration](https://www.terraform.io/docs/configuration/providers.html) in your `.tf` files, which defines what provider will be interpret the Terraform reosources
2. Update the [CI Terraform deployment script](https://github.com/nasa/cumulus/blob/master/bamboo/bootstrap-tf-deployment.sh) to deploy your module.
    - Make sure to add remote state handling for deploying your module so that each CI build only update the existing deployment as necessary, because local Terraform state in the CI will not persist between builds.
