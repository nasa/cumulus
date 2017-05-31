/**
 * Main entry point of the application. Sets up the store, reducers, routing, history, and the
 * display of the application.
 */
const { createStore, applyMiddleware, compose } = require('redux');
const { Provider } = require('react-redux');
const { Switch } = require('react-router-dom');
const { createBrowserHistory } = require('history');
const { Route } = require('react-router');
const { ConnectedRouter, routerMiddleware } = require('react-router-redux');

// Components
const NotFoundPage = require('./components/not-found-page').default;
const ErrorPage = require('./components/error-page').default;
const LandingPage = require('./components/landing-page').default;
const ProductPage = require('./components/product-page').default;

// Reducers
const reducers = require('./reducers').default;

const React = require('react');
const ReactDOM = require('react-dom');
const Immutable = require('immutable');

////////////////////////////////////////////////////////////////////////////////////////////////////
// Setup history

// Create a history of your choosing (we're using a browser history in this case)
const history = createBrowserHistory();

// This looks for hash options and changes it to a regular url.
// Based on some solutions described here:
// http://stackoverflow.com/questions/16267339/s3-static-website-hosting-route-all-paths-to-index-html
const convertHistoryHash = (location) => {
  // Check if the location hash is something like "#/foo" then we get just the "/foo" part
  const path = (/#(\/.*)$/.exec(location.hash) || [])[1];
  if (path) {
    history.replace(path);
  }
};

history.listen(convertHistoryHash);
// Fix the current load if necessary.
convertHistoryHash(history.location);

////////////////////////////////////////////////////////////////////////////////////////////////////
// Create the store with reducers

// Build the middleware for intercepting and dispatching navigation actions
const middleware = routerMiddleware(history);

/* eslint-disable no-underscore-dangle */
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
/* eslint-enable */

const store = createStore(reducers, Immutable.Map(), composeEnhancers(applyMiddleware(middleware)));

////////////////////////////////////////////////////////////////////////////////////////////////////
// Render the application
ReactDOM.render(
  <Provider store={store}>
    { /* Tell the Router to use our enhanced history */ }
    <ConnectedRouter history={history}>
      <Switch>
        <Route exact path="/" component={LandingPage} />
        <Route exact path="/workflows/:workflowId/products/:productId" component={ProductPage} />
        <Route path="/error" component={ErrorPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </ConnectedRouter>
  </Provider>,
  document.getElementById('mount'),
);
