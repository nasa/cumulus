'use strict';

const React = require('react');
const ReactDOM = require('react-dom');

const redux = require('redux');
const createStore = redux.createStore;
// const combineReducers = redux.combineReducers;
const applyMiddleware = redux.applyMiddleware;

const Provider = require('react-redux').Provider;

const createHistory = require('history').createBrowserHistory;

const Route = require('react-router').Route;

const reactRouterRedux = require('react-router-redux');
const ConnectedRouter = reactRouterRedux.ConnectedRouter;
const routerMiddleware = reactRouterRedux.routerMiddleware;

// Create a history of your choosing (we're using a browser history in this case)
const history = createHistory();

// Build the middleware for intercepting and dispatching navigation actions
const middleware = routerMiddleware(history);

// TODO setup reducers as needed
// const reducers  '<project-path>/reducers'

// Add the reducer to your store on the `routing` key
const store = createStore(
  // combineReducers({
  //   ...reducers,
  //   routing: routerReducer
  // })
  // TODO add a reducer function
  (v) => v,
  applyMiddleware(middleware)
);

// Components
import LandingPage from './components/landing-page';

function Foo () {
  return <p>I'm a foo</p>;
}

function Bar () {
  return <p>I'm a bar</p>;
}

ReactDOM.render(
  <Provider store={store}>
    { /* Tell the Router to use our enhanced history */ }
    <ConnectedRouter history={history}>
      <div>
        <Route path="/" component={LandingPage}/>
        <Route path="foo" component={Foo}/>
        <Route path="bar" component={Bar}/>
      </div>
    </ConnectedRouter>
  </Provider>,
  document.getElementById('mount')
);