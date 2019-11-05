---
id: troubleshoot_deployment
title: Troubleshooting Cumulus Deployment
hide_title: true
---

# Troubleshooting Cumulus Deployment

This document provides 'notes' on frequently encountered deployment issues. The issues reported are organized by relevant subsection.

## Install dashboard

### Dashboard configuration

Issues:

- __Problem clearing the cache: EACCES: permission denied, rmdir '/tmp/gulp-cache/default'__", this probably means the files at that location, and/or the folder, are owned by someone else (or some other factor prevents you from writing there).

It's possible to workaround this by editing the file `cumulus-dashboard/node_modules/gulp-cache/index.js` and alter the value of the line `var fileCache = new Cache({cacheDirName: 'gulp-cache'});` to something like `var fileCache = new Cache({cacheDirName: '<prefix>-cache'});`. Now gulp-cache will be able to write to `/tmp/<prefix>-cache/default`, and the error should resolve.

### Dashboard deployment

Issues:

- If the dashboard sends you to an Earthdata Login page that has an error reading __"Invalid request, please verify the client status or redirect_uri before resubmitting"__, this means you've either forgotten to update one or more of your EARTHDATA_CLIENT_ID, EARTHDATA_CLIENT_PASSWORD environment variables (from your app/.env file) and re-deploy Cumulus, or you haven't placed the correct values in them, or you've forgotten to add both the "redirect" and "token" URL to the Earthdata Application.
- There is odd caching behavior associated with the dashboard and Earthdata Login at this point in time that can cause the above error to reappear on the Earthdata Login page loaded by the dashboard even after fixing the cause of the error. If you experience this, attempt to access the dashboard in a new browser window, and it should work.
