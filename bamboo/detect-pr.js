/* eslint-disable node/no-unpublished-require */
/* eslint-disable no-console */

'use strict';

const graphql = require('@octokit/graphql');
// Query Github API for first commit on target ref and see if it has an associated pull request
async function getPrsForRef(currentRef) {
  const queryResponse = await graphql(`{
    repository(owner:"nasa", name:"cumulus") {
        name
        ref(qualifiedName: "${currentRef}") {
          name
          target {
            ... on Commit{
              history(first: 1) {
                nodes{
                  id
                  associatedPullRequests(last: 100) {
                    edges{
                      node{
                        title
                        state
                        baseRefName
                        }
                      }
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
  const edges = queryResponse.repository.ref.target.history.nodes[0].associatedPullRequests.edges;
  const nodes = edges.map((x) => x.node);
  if (nodes.length === 1) {
    console.log(`Current commit is a PR: ${JSON.stringify(nodes[0])}`);
    process.exitCode = 100;
  }
}

getPrsForRef(process.argv[2]).catch((e) => {
  console.log('Error querying API');
  console.log(e);
  process.exitCode = 1;
});
