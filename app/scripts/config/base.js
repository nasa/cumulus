module.exports = {
  // Defines the URL of the GIBS Ops API. The API provides most of data needed for the GUI.
  apiBaseUrl: undefined,
  // The name of the stack where step functions are deployed for GIBS.
  stackName: 'gitc-jg',
  // The name of the on earth stack
  onEarthStackName: 'gibs-oe-jg',
  // Indicates whether we should use canned data or make a real request to the API.
  useCannedData: false,
  // The number of executions to display in a list.
  numExecutions: 20
};
