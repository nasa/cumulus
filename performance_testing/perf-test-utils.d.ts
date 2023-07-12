declare const PolynomialRegression: any;
declare class PerformanceTester {
    private test;
    private iterations;
    private batchMax;
    private batchMin;
    private batchStart;
    private batchFinish;
    private maxDegree;
    constructor(test: Function, iterations: number, batchMax: number, batchMin?: number, batchStart?: Function | undefined, batchFinish?: Function | undefined, maxDegree?: Number);
    runBatch(batchSize: number): Promise<number>;
    measureBatches(): Promise<Array<Array<number>>>;
    performanceTest(): Promise<typeof PolynomialRegression>;
}
export = PerformanceTester;
//# sourceMappingURL=perf-test-utils.d.ts.map