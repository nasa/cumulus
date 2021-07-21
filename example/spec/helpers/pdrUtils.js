const { getPdr, deletePdr } = require('@cumulus/api-client/pdrs');

const { waitForApiStatus } = require('./apiUtils');

const waitAndDeletePdr = async (prefix, pdrName, status) => {
  await waitForApiStatus(
    getPdr,
    {
      prefix,
      pdrName,
    },
    status
  );
  await deletePdr({
    prefix,
    pdrName,
  });
};

module.exports = {
  waitAndDeletePdr,
};
