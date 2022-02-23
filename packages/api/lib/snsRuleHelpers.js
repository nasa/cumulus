function getSnsTriggerPermissionId(item) {
  return `${item.rule.value.split(':').pop()}Permission`.substring(0, 64);
}

module.exports = {
  getSnsTriggerPermissionId,
};
