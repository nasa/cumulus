'use strict';

const React = require('react');
import Header from './header.js';

function ErrorPage () {
  return (
    <div>
      <Header/>
      <main>
        <h1>Error</h1>
        <p className="message">An internal error has occurred.</p>
      </main>
    </div>
  );
}

export default ErrorPage;
