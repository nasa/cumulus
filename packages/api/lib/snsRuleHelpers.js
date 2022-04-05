const getSnsPermissionIdMaxLength = () => 64;
const getSnsPermissionIdSuffix = () => 'Permission';

function getSnsTriggerPermissionId(rule) {
  return `${rule.rule.value.split(':').pop()}${getSnsPermissionIdSuffix()}`.substring(
    0,
    getSnsPermissionIdMaxLength()
  );
}

module.exports = {
  getSnsPermissionIdMaxLength,
  getSnsPermissionIdSuffix,
  getSnsTriggerPermissionId,
};
