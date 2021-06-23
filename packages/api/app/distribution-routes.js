const router = require('express-promise-router')();
const {
  handleFileRequest,
  handleLocateBucketRequest,
  handleLoginRequest,
  handleLogoutRequest,
  handleRootRequest,
} = require('../endpoints/distribution');
const displayS3CredentialInstructions = require('../endpoints/s3credentials-readme');
const { handleCredentialRequest } = require('../endpoints/s3credentials');
const { ensureAuthorizedOrRedirect } = require('../lib/distribution');

const version = require('../endpoints/version');

const profile = (req, res) => res.send('Profile not available.');

router.get('/', handleRootRequest);
router.get('/locate', handleLocateBucketRequest);
router.get('/login', handleLoginRequest);
router.get('/logout', handleLogoutRequest);
router.get('/profile', profile);
router.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
router.get('/s3credentialsREADME', displayS3CredentialInstructions);
// Use router.use to leverage custom version middleware
router.use('/version', version);

router.head('/*', ensureAuthorizedOrRedirect, handleFileRequest);
router.get('/*', ensureAuthorizedOrRedirect, handleFileRequest);

module.exports = router;
