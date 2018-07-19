#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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
 * @param {Object} taskName - pname of the task package
 * @returns {string} markdown documentation
 */
function createTaskMarkdown(taskName) {
  const pkg = require(`../tasks/${taskName}/package.json`); // eslint-disable-line global-require, import/no-dynamic-require, max-len
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
  output.push(`### ${header}`);
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

/**
 * Get the list of tasks in the tasks folder
 *
 * @returns {Array} of task names
 */
function getTaskList() {
  const files = fs.readdirSync('tasks');
  return files
    .filter((file) => !file.startsWith('.'));
}

const taskDataRequests = getTaskList().sort();

Promise.all(taskDataRequests)
  .then(createTasksDoc)
  .catch(catchError);
