import { connect } from 'react-redux';
import { fetchProductStatus } from '../../reducers/product-status';
import { Table, Column } from '../table';

const functional = require('react-functional');
const React = require('react');
const { List } = require('immutable');

const ProductStatusTableFn = (props) => {
  const { products } = props.productStatus;
  return (
    <div>
      <h2>Product Status</h2>
      <Table className="product-status-table" data={products || List()}>
        <Column
          header="Product Type"
          valueFn={r => r.get('id')}
        />
        <Column
          header="Last Ingest"
          valueFn={r => r.get('last_ingest_time')}
        />
        <Column
          header="Status"
          valueFn={r => r.get('num_ingesting')}
        />
      </Table>
    </div>
  );
};

/**
 * @returns The properties to send to the ProductStatusTable component
 */
const productStatusStateToProps = ({ config, productStatus }) => ({ config, productStatus });

/**
 * Handles the alert list being mounted by initiating a check to get the API health
 */
function productStatusMount({ config, dispatch }) {
  fetchProductStatus(config, dispatch);
}

export default connect(productStatusStateToProps)(
  // Adds in the productStatusMount as a callback when the ProductStatusTable is mounted in React.
  functional(ProductStatusTableFn, { componentWillMount: productStatusMount }));
