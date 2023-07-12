const PolynomialRegression = require('ml-regression-polynomial');


function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}



class PerformanceTester {
  constructor(
    private test: Function,
    private iterations: number,
    private batchMax: number,
    private batchMin: number = 1,
    private batchStart: Function | undefined = undefined,
    private batchFinish: Function | undefined = undefined,
    private maxDegree: Number = 3,
  ) {}

  async runBatch(batchSize: number): Promise<number> {
    const batchData = this.batchStart && this.batchStart(batchSize);
    const begin = Date.now();
    for (let i = 0;  i < batchSize; i += 1) {
      await this.test(batchData[i]);
    }
    const end = Date.now();
    this.batchFinish && this.batchFinish(batchData);
    return end - begin;
  }
  async measureBatches(): Promise<Array<Array<number>>> {
    const batchSizes: Array<number> = [];
    const metrics: Array<number> = [];
    for (let i = 0; i < this.iterations; i += 1) {
      const batchSize = randomInt(this.batchMin, this.batchMax);
      const metric: number = await this.runBatch(batchSize);
      batchSizes.push(batchSize);
      metrics.push(metric);
    }
    return [batchSizes, metrics];
  }
  async performanceTest() {
    console.log(this.test)
    console.log(this.iterations)
    console.log(this.batchMax)
    console.log(this.batchMin)
    console.log(this.batchStart)
    console.log(this.batchFinish)
    console.log(this.maxDegree)
    const metrics = await this.measureBatches();
    const x = metrics[0];
    const y = metrics[1];
    const regression = new PolynomialRegression(x, y, this.maxDegree);
    console.log(regression);
  }
}

export = PerformanceTester