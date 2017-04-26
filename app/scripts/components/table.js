/**
 * Defines a table component in React. It expects that the data provided will be an Immutable JS
 * List of Maps. Each map must define a unique id.
 *
 * <Table className="some-specific-class" data={immutableJsListOfData}>
 *   <Column
 *     header="Column A"
 *     valueFn={r => r.get('a')}
 *   />
 *   <Column
 *     header="Column B"
 *     valueFn={r => r.get('b')}
 *   />
 * </Table>
 */
import { connect } from 'react-redux';
const React = require('react');

/**
 * Renders a row of data for the given columns.
 * Note the rowData needs to include id
 */
const renderRow = (columns, rowData) =>
  <tr key={rowData.get('id')}>
    {columns.map(c => <td key={c.props.header}>{c.props.valueFn(rowData)}</td>)}
  </tr>;


const handleColumnSortClick = (e, column) => {
  e.preventDefault();
  column.props.sortHandler();
};

/**
 * TODO
 */
const getSortIcon = (column, sortDirectionAsc) => {
  if (column.props.sorted) {
    if (sortDirectionAsc) {
      return <i className="fa fa-long-arrow-down" aria-hidden="true" />;
    }
    return <i className="fa fa-long-arrow-up" aria-hidden="true" />;
  }
  return <i className="fa fa-arrows-v" aria-hidden="true" />;
};

/**
 * Renders a Table component.
 * * children - should be the list of columns.
 * * className - a CSS class to use for styling.
 * * data - the source data for rendering the table.
 */
const TableFn = (props) => {
  const { children, className, data, sortDirectionAsc } = props;
  const columns = children;
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map(c =>
            <th key={c.props.header}>
              <a href="#" onClick={e => handleColumnSortClick(e, c)}>
                {getSortIcon(c, sortDirectionAsc)}
                &nbsp;
                {c.props.header}
              </a>
            </th>)}
        </tr>
      </thead>
      <tbody>
        {data.map(r => renderRow(children, r))}
      </tbody>
    </table>
  );
};

const Table = connect()(TableFn);

/**
 * Used for configuring a Table column. It should contain a header and valueFn.
 */
const Column = () => {
  // Never actually renders.
  throw new Error("I shouldn't be rendered");
};

export { Table, Column };
