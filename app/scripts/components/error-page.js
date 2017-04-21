'use strict';

import Header from './header';

const React = require('react');

/**
 * @return {JSX} Error page for the application
 */
function ErrorPage() {
  return (
    <div>
      <Header />
      <main>
        <h1>Error</h1>
        <p className="message">An internal error has occurred.</p>
      </main>
    </div>
  );
}

export default ErrorPage;
