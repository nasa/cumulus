export CI_UID=$(uid -u)
groupadd -g $CI_UID bamboo
useradd --gid bamboo --create-home --uid $CI_UID bamboo
su - bamboo
cd /source/cumulus/
npm install -g npm
npm install
ln -s /dev/stdout ./lerna-debug.log
npm run bootstrap-no-build