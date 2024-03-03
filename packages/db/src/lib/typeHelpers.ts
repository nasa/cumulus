import mapValues from 'lodash/mapValues';
import isNull from 'lodash/isNull';

const idFieldRegex = '^[a-zA-Z0-9_]*cumulus_id$';

type RecordTypeWithNumberIdField<T> = {
  [P in keyof T]: number | T[P];
};

type ArrayOfRecordTypeWithNumberIdField<T> = RecordTypeWithNumberIdField<T>[];

export const convertIdFieldsToNumber = <T extends Record<string, any>>(record: T)
  : RecordTypeWithNumberIdField<T> =>
    mapValues(record, (value, key) =>
      (key.match(idFieldRegex) && !isNull(value) ? Number(value) : value));

export const convertRecordsIdFieldsToNumber = <T extends Record<string, any>>(records: Array<T>)
  : ArrayOfRecordTypeWithNumberIdField<T> =>
    records.map((record: any) => convertIdFieldsToNumber(record));
