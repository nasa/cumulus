
const { Map } = require('immutable');

// Actions
const FORM_FIELD_VALUE_UPDATED = 'FORM_FIELD_VALUE_UPDATED';

const initialState = Map();

/**
 * Main reducer function for workflow status state.
 */
const reducer = (state = initialState, action) => {
  switch (action.type) {
    case FORM_FIELD_VALUE_UPDATED:
      return state.setIn([action.formName, action.fieldName], action.value);
    default:
      return state;
  }
};

/**
 * Creates an action for a form field value update.
 */
const updateFormFieldValue = (formName, fieldName, value) => (
  { type: FORM_FIELD_VALUE_UPDATED, formName, fieldName, value }
);

/**
 * Returns a helper object that has functions for getting values related to a form and dispatching
 * actions that indicate a value changed.
 */
const formHelper = ({ dispatch, formsState, formName, defaultValues, validator }) => {
  const safeForms = formsState || Map();
  const setValues = safeForms.get(formName);
  const formValues = defaultValues.merge(setValues);
  const fieldErrors = validator(formValues);

  return {
    /**
     * Dispatches an action indicating the field value was updated. The value is saved in the state.
     * The related values in the form in this helper are immutable and not updated when this
     * happens.
     */
    updateFieldValue: (fieldName, value) => {
      dispatch(updateFormFieldValue(formName, fieldName, value));
    },

    /**
     * Returns a saved field value.
     */
    getFieldValue: fieldName => formValues.get(fieldName),

    /**
     * Returns an immutable map of the values of the form.
     */
    getFieldValues: () => formValues,

    /**
     * Returns an error associated with the given field.
     */
    errorForField: fieldName => fieldErrors.get(fieldName),

    /**
     * Returns true if the current set of form values is valid.
     */
    isFormValid: () => !fieldErrors || fieldErrors.isEmpty()
  };
};

module.exports = {
  reducer,

  // Helpers
  formHelper

};

