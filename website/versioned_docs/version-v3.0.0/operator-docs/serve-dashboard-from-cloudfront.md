---
id: version-v3.0.0-serve-dashboard-from-cloudfront
title: Serve Cumulus Dashboard with CloudFront
hide_title: false
original_id: serve-dashboard-from-cloudfront
---

This document will briefly outline how to set up a [CloudFront](https://aws.amazon.com/cloudfront/) endpoint to serve the Cumulus Dashboard in an NASA/NGAP environment. Including, which [NASD](https://bugs.earthdata.nasa.gov/servicedesk/customer/portal/7) tickets are needed to request and configure a CloudFront endpoint.

First, upload a build of the cumulus dashboard to an AWS S3 bucket.  This can be simply running `aws s3 sync dist s3://<dashboard-bucket-name>` when you have a build of the dashboard in your `dist` directory.

Next, follow the NGAP directions for how to publish a [Private Application via CloudFront](https://wiki.earthdata.nasa.gov/display/ESKB/How+to+publish+a+Private+Application+via+CloudFront), in our case we are serving it from private S3 buckets.

After that has been provisioned, you must file a ticket to request a redirect of missing pages to your index page. Go to the [Earthdata Cloud Egress Custom Error Pages](https://wiki.earthdata.nasa.gov/display/ESKB/Earthdata+Cloud+Egress+Custom+Error+Pages), and scroll down to
[Submitting NASD ticket for Custom Error Pages on a EDC Tenant Account](https://wiki.earthdata.nasa.gov/display/ESKB/Earthdata+Cloud+Egress+Custom+Error+Pages#EarthdataCloudEgressCustomErrorPages-SubmittingNASDticketforCustomErrorPagesonaEDCTenantAccount).

Follow the instructions there and in your description use just request your CloudFront URL to have `404 error`s transformed to `200 Success` and redirect to `/index.html`

```sh
Description
CloudFront URL: https://<hash>.cloudfront.net
Error Code: 404
redirect: /index.html
Transformed Error Code: 200
```
