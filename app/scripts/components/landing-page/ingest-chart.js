'use strict';

/**
 * Defines a chart for displaying Ingest performance. The chart is a small inline one that when
 * clicked shows a modal popover chart.
 */

const React = require('react');
const functional = require('react-functional');
const LineChart = require('react-chartjs-2').Line;

/**
 * Returns the chart options to use for the modal chart.
 */
const modalChartOptions = title => ({
  responsive: false,
  maintainAspectRatio: false,
  title: {
    display: true,
    text: title
  },
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
});

/**
 * Returns the options to use with the inline chart.
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
 * Takes ingest performance and converts it into the data that can be displayed in the chart.
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
 * Converts a GUID to a unique DOM node id for the modal chart.
 */
const guidToModalId = guid => `modal-chart-${guid}`;

 /**
 * Converts a GUID to a unique DOM node id for the inline chart.
 */
const guidToInlineId = guid => `inline-chart-${guid}`;


/**
 * Defines the modal line chart.
 */
const ModalChart = ({ guid, chartData, title }) =>
  <div className="eui-modal-content" id={guidToModalId(guid)}>
    <LineChart
      data={chartData}
      width={750}
      height={300}
      options={modalChartOptions(title)}
    />
  </div>;

/**
 * Defines the inline line chart
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
 * Defines the ingest chart with an inline chart that when clicked shows a larger modal chart.
 */
const IngestChartFn = ({ ingestPerf, guid, title }) => {
  const chartData = ingestPerfToChartData(ingestPerf);

  return (
    <div>
      <ModalChart guid={guid} chartData={chartData} title={title} />
      <InlineChart guid={guid} chartData={chartData} />
    </div>
  );
};

/**
 * Wraps the ingest chart function with a react component classes that will enable the modal
 * behavior when the component is mounted.
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
