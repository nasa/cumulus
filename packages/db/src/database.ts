import { Knex } from 'knex';

export const isRecordDefined = <T>(record: T) => record !== undefined;

/**
 * Helper function to create Knex.Transaction and specify promise rejection behavior
 *
 * This is necessary because in Knex 0.95.0+, the default behavior of knex.transaction
 * with callbacks changed from rejecting the promise for transaction rollback to
 * NOT rejecting the promise for transaction rollback.
 *
 * We are specifying `doNotRejectOnRollback: false` to ensure that the transaction
 * rollback DOES trigger a promise rejection.
 *
 * See https://github.com/knex/knex/blob/master/UPGRADING.md#upgrading-to-version-0950.
 *
 * @param {Knex} knex
 * @param {function} handlerFn
 * @returns {Promise}
 */
export const createRejectableTransaction = async <T>(
  knex: Knex,
  handlerFn: (trx: Knex.Transaction) => any
) => await knex.transaction<T>(handlerFn, { doNotRejectOnRollback: false });
