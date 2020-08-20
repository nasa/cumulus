// import Knex from 'knex';
// import { createLocalStackClient } from './knex';

export interface Collection {
  cumulusId?: number
  name: string,
  version: string,
}

export interface CollectionRecord extends Collection {
  cumulusId: number
}

// export const insert = ({
//   knex,
//   collection,
// }: {
//   knex: Knex<any, unknown[]>,
//   collection: Collection
// }) =>
//   knex<CollectionRecord>('collections')
//     .insert(collection, 'cumulusId');

// (async () => {
//   const x = await insert({
//     knex: createLocalStackClient(),
//     collection: {
//       name: 'asdf',
//       version: 'asdf',
//     },
//   });

//   console.log(x);
// })();
