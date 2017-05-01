/**
 * Defines a sortable table component in React. It expects that the data provided will be an
 * Immutable JS List of Maps. Each map must define a unique id.
 *
 * <Table className="some-specific-class" data={immutableJsListOfData} sortDirectionAsc={asc}>
 *   <Column
 *     header="Column A"
 *     valueFn={r => r.get('a')}
 *     sorted={isASorted()}
 *     sortHandler={...}
 *   />
 *   <Column
 *     header="Column B"
 *     valueFn={r => r.get('b')}
 *     sorted={isBSorted()}
 *     sortHandler={...}
 *   />
 * </Table>
 */
const React = require('react');
const Icon = require('./icon');

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
 * Returns the icon indicating the direction of the sort on the column.
 */
const getSortIcon = (column, sortDirectionAsc) => {
  if (column.props.sorted) {
    if (sortDirectionAsc) {
      return <Icon className="icon-sort fa-sort-down" />;
    }
    return <Icon className="icon-sort fa-sort-up" />;
  }
  return <Icon className="icon-sort fa-sort" />;
};

/**
 * Renders a Table component.
 * * children - should be the list of columns.
 * * className - a CSS class to use for styling.
 * * data - the source data for rendering the table.
 * * sortDirectionAsc - true or false to indicate the sort direction.
 */
const Table = (props) => {
  const { children, className, data, sortDirectionAsc } = props;
  const columns = children;
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map(c =>
            <th key={c.props.header}>
              <a role="button" href="/" onClick={e => handleColumnSortClick(e, c)}>
                {c.props.header}
                {getSortIcon(c, sortDirectionAsc)}
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

/**
 * Used for configuring a Table column. It should contain a header and valueFn.
 */
const Column = () => {
  // Never actually renders.
  throw new Error("I shouldn't be rendered");
};

export { Table, Column };
