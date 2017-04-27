'use strict';

const Header = require('./header').default;
const React = require('react');

/**
 * @return {JSX} Error page for the application
 */
const ErrorPage = () =>
  <div>
    <Header />
    <main>
      <h1>Error</h1>
      <p className="message">An internal error has occurred.</p>
    </main>
  </div>;

export default ErrorPage;
