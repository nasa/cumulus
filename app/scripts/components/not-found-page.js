'use strict';

const React = require('react');
import Header from './header.js';

function NotFoundPage () {
  return (
    <div>
      <Header/>
      <main>
        <h1>404</h1>
        <p className="message">Sorry! The page you were looking for does not exist.</p>
      </main>
    </div>
  );
}

export default NotFoundPage;
