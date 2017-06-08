'use strict';

const React = require('react');
const { connect } = require('react-redux');

// Use this import when eventually adding real links.
// import {Link} from 'react-router-dom';

/**
 * @returns {JSX} Header for the application.
 */
const headerFn = ({ errors }) =>
  <div>
    <header className="doc-mast">
      <div className="container">
        <div className="eui-masthead-logo eui-application-logo">
          <h1>
            <a href="/">GIBS Ops Dashboard</a>
            <span className="eui-badge--sm">BETA</span>
          </h1>
        </div>
      </div>
    </header>
    {
      errors.map(error =>
        <div className="eui-banner--danger">
          <p className="eui-banner__message">
            <strong>Error</strong> {error}
          </p>
        </div>
      )
    }
  </div>;

const headerStatToProps = ({ errors }) => ({ errors });

const Header = connect(headerStatToProps)(headerFn);

export default Header;
