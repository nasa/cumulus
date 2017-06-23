const React = require('react');
const { connect } = require('react-redux');
const functional = require('react-functional');
const { Set, Map } = require('immutable');
const formsReducer = require('../../reducers/forms');
const ws = require('../../reducers/workflow-status');
const util = require('../../util');

/**
 * Adds a datepicker based on https://github.com/uxsolutions/bootstrap-datepicker
 * Assumes that the CSS and JS for that are available. (As of this comment time they were added
* on main index.html through CDN links.)
 */
const DatePicker = functional(
  ({ name, id, defaultValue }) =>
    <input
      type="text"
      className="form-control default"
      name={name}
      id={id}
      defaultValue={util.toDateString(defaultValue)}
    />,
  {
    componentDidMount: ({ id, onChange }) => {
      // eslint-disable-next-line no-undef
      $(`#${id}`).datepicker({
        maxViewMode: 2,
        format: 'yyyy-mm-dd',
        todayBtn: 'linked',
        autoclose: true
      }).on('changeDate', (event) => {
        if (onChange) {
          onChange(event.date);
        }
      });
    }
  }
);


/**
 * TODO
 */
const FormError = ({ formHelper, field }) =>
  <span className="form-error">{formHelper.errorForField(field)}</span>;

/**
 * TODO
 */
const DateField = ({ idPrefix, name, formHelper, label }) =>
  <div className="form-field">
    <label htmlFor={`${idPrefix}-${name}`}>{label}:</label>
    <DatePicker
      name={name}
      id={`${idPrefix}-${name}`}
      defaultValue={formHelper.getFieldValue(name)}
      onChange={date => formHelper.updateFieldValue(name, date)}
    />
    <FormError formHelper={formHelper} field={name} />
  </div>;

/**
 * TODO
 */
const MultiSelectField = ({ idPrefix, name, formHelper, label, size, values }) => {
  const selectedValueSet = formHelper.getFieldValue(name) || Set();
  return (
    <div className="form-field">
      <label htmlFor={`${idPrefix}-${name}`}>{label}:</label>
      <select
        className="multi-select"
        size={size}
        multiple="multiple"
        name={name}
        id={`${idPrefix}-${name}`}
        value={selectedValueSet.toJS()}
        onChange={(event) => {
          const optionsArray = Array.prototype.slice.call(event.target.selectedOptions);
          const selectedValues = optionsArray.map(o => o.value);
          formHelper.updateFieldValue(name, Set(selectedValues));
        }}
      >
        {
          values.map(v =>
            <option key={v}>
              {v}
            </option>
          )
        }
      </select>
      <FormError formHelper={formHelper} field={name} />
    </div>
  );
};

/**
 * TODO
 */
const workflowReingestFormStateToProps = ({ config, forms, workflowStatus }) =>
  ({ config, forms, workflowStatus });

/**
 * TODO
 */
const defaultFormValues = (workflow) => {
  const firstProductId = workflow.getIn(['products', 0, 'id']);
  return Map({
    startDate: new Date(Date.now()),
    endDate: new Date(Date.now()),
    selectedProducts: Set([firstProductId])
  });
};

/**
 *
 */
const workflowFormValidator = ({ startDate, endDate, selectedProducts }) => {
  const errors = {};
  if (startDate.valueOf() > endDate.valueOf()) {
    errors.startDate = 'Start Date must be less than or equal to End Date';
  }
  if (selectedProducts.isEmpty()) {
    errors.selectedProducts = 'Select at least one product';
  }
  return Map(errors);
};


/**
 * TODO
 */
const WorkflowReingestForm = connect(workflowReingestFormStateToProps)(
  (props) => {
    const { config, workflow, forms, dispatch } = props;
    const { id, products } = workflow;
    // const formHelper = formsReducer.formHelper(
    //   dispatch, forms, 'WorkflowReingestForm', defaultFormValues, workflowFormValidator);
    const formHelper = formsReducer.formHelper({
      dispatch,
      formsState: forms,
      formName: 'WorkflowReingestForm',
      defaultValues: defaultFormValues(workflow),
      validator: workflowFormValidator,
      submitHandler: ({ selectedProducts, startDate, endDate }) =>
        ws.reingestGranules(config, selectedProducts.toArray(), startDate, endDate, dispatch)
    });

    return (
      <form>
        <DateField idPrefix={id} formHelper={formHelper} name="startDate" label="Start Date" />
        <DateField idPrefix={id} formHelper={formHelper} name="endDate" label="End Date" />
        <MultiSelectField
          idPrefix={id}
          formHelper={formHelper}
          name="selectedProducts"
          label="Products"
          size={Math.min(4, products.count())}
          values={products.map(p => p.get('id'))}
        />
        <input
          className="button submit eui-btn eui-btn--green modal-close-trigger"
          type="submit"
          disabled={!formHelper.isFormValid()}
          defaultValue="Reingest"
          onClick={(e) => {
            e.preventDefault();
            const { selectedProducts, startDate, endDate } = formHelper.getFieldValues();
            ws.reingestGranules(config, selectedProducts.toArray(), startDate, endDate, dispatch);
          }}
        />
        <button type="button" className="cancel eui-btn modal-close-trigger">Cancel</button>
      </form>
    );
  }
);

module.exports = {
  WorkflowReingestForm
};
