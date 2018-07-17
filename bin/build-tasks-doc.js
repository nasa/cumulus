#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const got = require('got');

const npmUrl = 'https://registry.npmjs.com/';
const tasksHeaderPath = path.join(__dirname, 'tasks-header.md');
const tasksHeader = fs.readFileSync(tasksHeaderPath, 'utf8');
const tasksOutputFilePath = path.join(__dirname, '..', 'docs', 'tasks.md');

/**
 * Handle error by logging and exiting process with error code
 *
 * @param {Object} err - error
 * @returns {undefined} - none
 */
function catchError(err) {
  console.log(err); // eslint-disable-line no-console
  process.exit(1);
}

/**
 * Get the task package data from npm
 *
 * @param {string} taskName - task name i.e. @cumulus/discover-granules
 * @returns {Object} task data from npm
 */
function getTaskPkg(taskName) {
  // npm registry is weird. it wants slashes to be uri encoded but not @ symbols
  const url = npmUrl + taskName.split('/').join('%2F');
  return got(url, { json: true }).then((res) => res.body);
}

/**
 * Create the links for task resources
 *
 * @param {string} packageName - package name i.e. @cumulus/discover-granules
 * @param {string} sourceUrl - url to Cumulus repo
 * @param {string} homepage - url to task code
 * @returns {string} String with links to npm, source, web
 */
function createTaskResourceLinks(packageName, sourceUrl, homepage) {
  const links = [`[npm](https://npmjs.com/package/${packageName})`];
  if (sourceUrl) links.push(`[source](${sourceUrl})`);
  if (homepage) links.push(`[web](${homepage})`);

  return links.join(' | ');
}

/**
 * Create the markdown documentation for the task using package
 * data from npm
 *
 * @param {Object} pkg - package data from npm
 * @returns {string} markdown documentation
 */
function createTaskMarkdown(pkg) {
  const name = pkg.name;
  const homepage = pkg.homepage;
  const description = pkg.description;

  let sourceUrl = pkg.repository && pkg.repository.url;
  if (sourceUrl) {
    const match = sourceUrl.match(/git\+(.*?)\.git?/);
    if (match) sourceUrl = match[1];
  }

  const output = [];

  const header = homepage ? `[${name}](${homepage})` : name;
  output.push(`### ${header}`)
  output.push(description);
  output.push('');
  if (homepage) {
    output.push(
      `- Schemas: See this module's [schema definitions](${homepage}/schemas).`
    );
  }
  output.push(`- Resources: ${createTaskResourceLinks(name, sourceUrl, homepage)}`);

  return output.join('\n');
}

/**
 * Create markdown task documentation for list of tasks
 *
 * @param {Array<string>} tasks - list of task package data from npm
 * @returns {undefined} - none
 */
function createTasksDoc(tasks) {
  const tasksMarkdown = tasks.map(createTaskMarkdown).join('\n\n---\n\n');
  const markdown = tasksHeader + tasksMarkdown;

  fs.writeFile(tasksOutputFilePath, markdown, (err) => {
    if (err) catchError(err);
  });
}

function getTaskList() {
  const files = fs.readdirSync('tasks');
  return files
    .filter((file) => !file.startsWith('.'))
    .map((file) => `@cumulus/${file}`);
}

const taskDataRequests = getTaskList().sort().map(getTaskPkg);

Promise.all(taskDataRequests)
  .then(createTasksDoc)
  .catch(catchError);
