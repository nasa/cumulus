/* eslint-disable node/no-unpublished-require */
/* eslint-disable no-console */

'use strict';

const graphql = require('@octokit/graphql');
async function getAllPrShas(currentSha) {
  const queryResponse = await graphql(`{
    repository(owner:"nasa", name:"cumulus") {
      name
      pullRequests(last:100, states: OPEN) {
        edges {
          node {
            title
            commits(last:1){
              nodes {
                commit {
                  oid
                }
              }
            }
          }
        }
      }
    }
  }`, {
    headers: {
      authorization: `token ${process.env.GITHUB_TOKEN}`
    }
  });
  const edges = queryResponse.repository.pullRequests.edges;
  const shas = edges.map((x) => x.node.commits.nodes[0].commit.oid);
  console.log(shas.includes(currentSha));
}

getAllPrShas(process.argv[2]).catch((e) => {
  console.log('Error matching PR SHAs:');
  console.log(e);
  process.exitCode = 1;
});
