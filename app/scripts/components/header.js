'use strict';
const React = require('react');

/**
 * Defines a Header for the application.
 */
function Header () {
  return (
    <header className="doc-mast">
      <div className="container">
        <div className="eui-masthead-logo eui-application-logo">
          <h1><a href="#">GIBS Ops Dashboard</a> <span className="eui-badge--sm">BETA</span></h1>
        </div>

        <nav className="main-nav" role="navigation">
          <ul className="main-nav-list">
            {/* These don't link to anything for now. */}
            <li><a href="#">Settings</a></li>
            <li><a href="#">Login</a></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export default Header;
