const React = require('react');
const functional = require('react-functional');

/* eslint-disable camelcase */

const showModalClickableId = (modalType, uniqId) => `btn-show-${modalType}-${uniqId}`;
const modalDivId = (modalType, uniqId) => `modal-div-${modalType}-${uniqId}`;

/**
 * Defines a clickable set of content that will display the modal. The only required element is the
 * children. modalType and uniqId are set by the parent.
 */
const ModalClickable = ({ modalType, uniqId, className, children }) =>
  <span
    className={className}
    id={showModalClickableId(modalType, uniqId)}
    name={modalDivId(modalType, uniqId)}
    href={`#${modalDivId(modalType, uniqId)}`}
  >
    {children}
  </span>;

/**
 * Defines a button which will display the modal content. modalType and uniqId are set by the
 * parent.
 */
const ModalButton = ({ modalType, uniqId, className, children }) =>
  <button
    type="button"
    className={`eui-btn ${className}`}
    id={showModalClickableId(modalType, uniqId)}
    name={modalDivId(modalType, uniqId)}
    href={`#${modalDivId(modalType, uniqId)}`}
  >
    {children}
  </button>;

/**
 * Defines some content that will be shown modally. modalType and uniqId are set by the parent.
 */
const ModalContent = ({ className, modalType, uniqId, children }) =>
  <div
    className={`eui-modal-content ${className}`}
    id={modalDivId(modalType, uniqId)}
  >
    <button type="button" className="icon fa fa-close modal-close modal-close-trigger" />
    {children}
  </div>;

/**
 * Helper function for verifying the children of Modal are correct.
 */
const getChildren = (children) => {
  const errorMsg = 'Children must be 2 elements consisting of a clickable (ModalClickable or' +
    ' ModalButton) and ModalContent in that order';
  const throwIf = (test) => {
    if (test) {
      throw new Error(errorMsg);
    }
  };

  throwIf(children.length !== 2);
  const [clickable, content] = children;
  throwIf(clickable.type !== ModalClickable && clickable.type !== ModalButton);
  throwIf(content.type !== ModalContent);

  return [clickable, content];
};

/**
 * Defines a set of modally displayed content and a trigger to show the modal content. Parameters:
 * * modalType - Some string identifying the kind of modal that will be displayed. Used with uniqId
 * for generating a unique DOM id.
 * * uniqId - a string to uniquely identify this modal among the modalType
 * * children - This should be two child elements. The first element should be either ModalClickable
 * or ModalButton. The second should be ModalContent.
 */
const ModalFn = ({ modalType, uniqId, children }) => {
  let [clickable, content] = getChildren(children);

  clickable = React.cloneElement(clickable, { modalType, uniqId });
  content = React.cloneElement(content, { modalType, uniqId });

  return (<span>{clickable}{content}</span>);
};

/**
 * Defines the Modal container for the trigger and the content.
 */
const Modal = functional(
  ModalFn, {
    componentDidMount: ({ modalType, uniqId }) => {
      // Use EUI recommended method for creating modal content.
      // eslint-disable-next-line no-undef
      $(`#${showModalClickableId(modalType, uniqId)}`).leanModal({
        closeButton: '.modal-close-trigger'
      });
    }
  }
);


module.exports = { Modal, ModalClickable, ModalButton, ModalContent };
