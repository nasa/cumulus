'use strict';

const React = require('react');

// Use this import when eventually adding real links.
// import {Link} from 'react-router-dom';

/**
 * @returns {JSX} Header for the application.
 */
const Header = () =>
  <header className="doc-mast">
    <div className="container">
      <div className="eui-masthead-logo eui-application-logo">
        <h1>
          <a href="/">GIBS Ops Dashboard</a>
          <span className="eui-badge--sm">BETA</span>
        </h1>
      </div>
    </div>
  </header>;

export default Header;
