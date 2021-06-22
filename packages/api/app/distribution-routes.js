const router = require('express-promise-router')();
const {
  handleLoginRequest,
  handleLogoutRequest,
  rootRouter,
} = require('../endpoints/distribution');
const displayS3CredentialInstructions = require('../endpoints/s3credentials-readme');
const { handleCredentialRequest } = require('../endpoints/s3credentials');
const { ensureAuthorizedOrRedirect } = require('../lib/distribution');

const version = require('../endpoints/version');

const locate = (req, res) => res.status(501).end();

const profile = (req, res) => res.send('Profile not available.');

router.get('/locate', locate);
router.get('/login', handleLoginRequest);
router.get('/logout', handleLogoutRequest);
router.get('/profile', profile);
router.get('/s3credentials', ensureAuthorizedOrRedirect, handleCredentialRequest);
router.get('/s3credentialsREADME', displayS3CredentialInstructions);
// Use router.use to leverage custom version middleware
router.use('/version', version);

// GET / <- welcome page
// HEAD /*
// GET /* <- Actual presigned URL
router.use('/', rootRouter);

module.exports = router;
