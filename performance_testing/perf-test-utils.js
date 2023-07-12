"use strict";
const PolynomialRegression = require('ml-regression-polynomial');
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}
class PerformanceTester {
    constructor(test, iterations, batchMax, batchMin = 1, batchStart = undefined, batchFinish = undefined, maxDegree = 3) {
        this.test = test;
        this.iterations = iterations;
        this.batchMax = batchMax;
        this.batchMin = batchMin;
        this.batchStart = batchStart;
        this.batchFinish = batchFinish;
        this.maxDegree = maxDegree;
    }
    async runBatch(batchSize) {
        const batchData = this.batchStart && this.batchStart(batchSize);
        const begin = Date.now();
        for (let i = 0; i < batchSize; i += 1) {
            await this.test(batchData[i]);
        }
        const end = Date.now();
        this.batchFinish && this.batchFinish(batchData);
        return end - begin;
    }
    async measureBatches() {
        const batchSizes = [];
        const metrics = [];
        for (let i = 0; i < this.iterations; i += 1) {
            const batchSize = randomInt(this.batchMin, this.batchMax);
            const metric = await this.runBatch(batchSize);
            batchSizes.push(batchSize);
            metrics.push(metric);
        }
        return [batchSizes, metrics];
    }
    async performanceTest() {
        const metrics = await this.measureBatches();
        const x = metrics[0];
        const y = metrics[1];
        const regression = new PolynomialRegression(x, y, this.maxDegree);
        console.log(this.test);
        console.log(regression);
        return regression;
    }
}
module.exports = PerformanceTester;
//# sourceMappingURL=perf-test-utils.js.map