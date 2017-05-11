const React = require('react');
const functional = require('react-functional');
const LineChart = require('react-chartjs-2').Line;

/**
 * TODO
 */
const modalChartOptions = {
  responsive: false,
  maintainAspectRatio: false,
  scales: {
    xAxes: [{
      type: 'time',
      time: {
        format: 'MM/DD/YYYY',
        tooltipFormat: 'MM/DD/YYYY'
      }
    }],
    yAxes: [{
      ticks: {
        beginAtZero: true,
        callback: label => `${label} secs`
      }
    }]
  }
};

/**
 * TODO
 */
const inlineChartOptions = {
  responsive: false,
  maintainAspectRatio: false,
  layout: { padding: { top: 5, bottom: 3 } },
  legend: { display: false },
  tooltips: { enabled: false },
  scales: {
    xAxes: [{
      type: 'time',
      display: false
    }],
    yAxes: [{
      display: false,
      ticks: { beginAtZero: true }
    }]
  }
};

/**
 * TODO
 */
const ingestPerfToChartData = (ingestPerf) => {
  if (ingestPerf.isEmpty()) {
    return { datasets: [] };
  }
  const percentiles = ingestPerf.first().keySeq().filter(k => k !== 'date').toArray();
  const datasets = percentiles.map((p) => {
    const points = ingestPerf.map(perf => ({
      x: perf.get('date'),
      y: Math.round(perf.get(p)) / 1000
    })).toArray();
    return { label: `${p}th Percentile`, data: points };
  });
  return { datasets };
};

/**
 * TODO
 */
const guidToModalId = guid => `modal-chart-${guid}`;

/**
 * TODO
 */
const guidToInlineId = guid => `inline-chart-${guid}`;


/**
 * TODO
 */
const ModalChart = ({ guid, chartData }) =>
  <div className="eui-modal-content" id={guidToModalId(guid)}>
    <LineChart
      data={chartData}
      width={750}
      height={300}
      options={modalChartOptions}
    />
  </div>;

/**
 * TODO
 */
const InlineChart = ({ guid, chartData }) =>
  <div
    id={guidToInlineId(guid)}
    name={guidToModalId(guid)}
    href={`#${guidToModalId(guid)}`}
  >
    <LineChart
      data={chartData}
      height={38}
      width={200}
      options={inlineChartOptions}
    />
  </div>;

/**
 * TODO
 */
const IngestChartFn = ({ ingestPerf, guid }) => {
  const chartData = ingestPerfToChartData(ingestPerf);

  return (
    <div>
      <ModalChart guid={guid} chartData={chartData} />
      <InlineChart guid={guid} chartData={chartData} />
    </div>
  );
};

/**
 * TODO
 */
const IngestChart = functional(
  IngestChartFn, {
    componentDidMount: ({ guid }) => {
      // Use EUI recommended method for creating modal content.
      // eslint-disable-next-line no-undef
      $(`#${guidToInlineId(guid)}`).leanModal();
    }
  }
);

module.exports = { IngestChart };
