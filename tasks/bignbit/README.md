# BigNBit (External Repo)

This directory includes a Terraform module that fetches the BigNBit source from `https://github.com/podaac/bignbit/releases/download/0.4.1/bignbit-0.4.1-cumulus-tf.zip`.

## Deployment

1. Navigate to the `/bignbit/deploy` directory
2. Duplicate `terraform.tfvars.example` and rename to `terraform.tfvars`
3. Update `terraform.tfvars` with your environment's variables
4. Run `terraform init`
5. Run `terraform plan` to check the output and `terraform apply` to deploy

## Contributing

To make a contribution, please [see our Cumulus contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) and our documentation on [adding a task](https://nasa.github.io/cumulus/docs/adding-a-task)

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)
