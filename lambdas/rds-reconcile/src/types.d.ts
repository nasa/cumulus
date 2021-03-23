declare module '@cumulus/api';

type ReportObj = {
  [key: string]: {
    pdrs: number,
    granules: number,
    executions: number,
  }
};

type StatsObject = {
  collectionId: string;
  counts: [number, number, number, number, number, number];
};
