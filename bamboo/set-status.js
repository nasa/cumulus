/* eslint-disable node/no-unpublished-require */
/* eslint-disable no-console */
"use strict";
const token = process.env.GITHUB_TOKEN;
const githubUser = process.env.GITHUB_USER;

const Octokit = require("@octokit/rest");
const retryPlugin = require("@octokit/plugin-retry");
const throttlePlugin = require("@octokit/plugin-throttling");

async function updateRefState(ref, state, targetUrl) {
  const baseUrl = "https://api.github.com";
  const owner = 'nasa';
  const repo = 'cumulus';

  const octokit = new Octokit({
    auth: token,
    userAgent: "Cumulus Bamboo",
    baseUrl: baseUrl,
    throttle: {
      onAbuseLimit: () => true,
      onRateLimit: () => true
    }
  });

  const statuses = await octokit.repos.listStatusesForRef({ owner, repo, ref });

  const updateObject = {
    sha: ref,
    repo: repo,
    owner: owner,
    state: state,
    description: 'Cumulus Bamboo CI',
  };
  const result = await octokit.repos.createStatus(updateObject);
  return result;

}

const sha = process.argv[2];
const status = process.argv[3];
const targetUrl = process.argv[4];

updateRefState(sha, status, "https://test.com")
  .then(() => {
    console.log('success');
    return true;
  })
  .catch((e) => {
    console.log(`bah humbug: ${JSON.stringify(e)}`);
    return false;
  });
