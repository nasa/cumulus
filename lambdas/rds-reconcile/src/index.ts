import { Context } from 'aws-lambda';

import { esSearch, models } from '@cumulus/api';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { executions } from '../../../tasks/discover-granules/node_modules/@cumulus/api-client/src';
import { getCollections } from '@cumulus/api-client/collections';
import { getExecutions } from '@cumulus/api-client/executions';
import { listGranules } from '@cumulus/api-client/granules';
import { parse } from 'node:path';

const search = esSearch.Search;



const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<any> => {

  // Take handler structure

  const prefix = 'jk-tf4';
  let promises = [];

/*   const collectionResponse = getCollections({
    prefix: process.env.stackName,
  });
  const collectionResponseBody = JSON.parse(collectionResponse.body);

  const collections = collectionResponseBody.results; */

  const dynamoCollectionModel = new models.Collection(); // set env var
  const dynamoProvidersModel = new models.Provider(); // set env var
  const dynamoRulesModel = new models.Rule(); // set env var
  const [dynamoCollections, dynamoProviders, dynamoRules] = await Promise.all([
    dynamoCollectionModel.getAllCollections(),
    dynamoProvidersModel.getAllProviders(),
    dynamoRulesModel.getAllRules()
  ]);

  const executionCount = JSON.parse((await getExecutions({ prefix })).body).meta.count;
  const granuleCount = JSON.parse((await (listGranules({ prefix }))).body).meta.count;
  const pdrCount = JSON.parse((await (listPdrs )))

  // BY collection:
  // Get counts asyncOperations -- ES (is this in ES)
  // Get counts executions      -- ES
  // Get counts granules        -- ES
  // Get counts PDRs            -- ES
}