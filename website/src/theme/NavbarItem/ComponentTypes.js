const ComponentTypesModule = require('@theme-original/NavbarItem/ComponentTypes');
const VersionedNavbarItemModule = require('@site/src/components/VersionedNavbarItem');

const ComponentTypes = ComponentTypesModule.default || ComponentTypesModule;
const versionedNavbarItemModule = VersionedNavbarItemModule;
const VersionedNavbarItem = versionedNavbarItemModule.default || versionedNavbarItemModule;

// eslint-disable-next-line prefer-object-spread
module.exports = Object.assign({}, ComponentTypes, {
  'custom-versionedNavbarItem': VersionedNavbarItem,
});
