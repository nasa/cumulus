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
const React = require('react');

/**
 * Renders a row of data for the given columns.
 * Note the rowData needs to include id
 */
const renderRow = (columns, rowData) =>
  <tr key={rowData.get('id')}>
    {columns.map(c => <td key={c.props.header}>{c.props.valueFn(rowData)}</td>)}
  </tr>;

/**
 * Renders a Table component.
 * * children - should be the list of columns.
 * * className - a CSS class to use for styling.
 * * data - the source data for rendering the table.
 */
const Table = ({ children, className, data }) => {
  const columns = children;
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map(c => <th key={c.props.header}>{c.props.header}</th>)}
        </tr>
      </thead>
      <tbody>
        {data.map(r => renderRow(children, r))}
      </tbody>
    </table>
  );
};

/**
 * Used for configuring a Table column. It should contain a header and valueFn.
 */
const Column = () => {
  // Never actually renders.
  throw new Error("I shouldn't be rendered");
};

export { Table, Column };
