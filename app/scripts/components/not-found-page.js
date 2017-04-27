'use strict';

import Header from './header';
const React = require('react');

/**
 * @return {JSX} Page to show when the route is not found.
 */
const NotFoundPage = () =>
  <div>
    <Header />
    <main>
      <h1>404</h1>
      <p className="message">Sorry! The page you were looking for does not exist.</p>
    </main>
  </div>;

export default NotFoundPage;
