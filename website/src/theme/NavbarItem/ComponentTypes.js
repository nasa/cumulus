const ComponentTypesModule = require('@theme-original/NavbarItem/ComponentTypes');
const IcebergVersionedNavbarItemModule = require('@site/src/components/IcebergVersionedNavbarItem');

const ComponentTypes = ComponentTypesModule.default || ComponentTypesModule;
const icebergNavbarItemModule = IcebergVersionedNavbarItemModule;
const IcebergVersionedNavbarItem = icebergNavbarItemModule.default || icebergNavbarItemModule;

// eslint-disable-next-line prefer-object-spread
module.exports = Object.assign({}, ComponentTypes, {
  'custom-icebergVersioned': IcebergVersionedNavbarItem,
});
