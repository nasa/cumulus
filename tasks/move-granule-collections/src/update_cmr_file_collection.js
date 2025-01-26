"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.isCMRMetadataFile = exports.getCMRMetadata = exports.updateCmrFileCollections = exports.uploadCMRFile = void 0;
var S3_1 = require("@cumulus/aws-client/S3");
var CMR_1 = require("@cumulus/cmr-client/CMR");
var cmr_utils_1 = require("@cumulus/cmrjs/cmr-utils");
var assert_1 = require("assert");
var cloneDeep_1 = require("lodash/cloneDeep");
var get_1 = require("lodash/get");
var set_1 = require("lodash/set");
// import xml2js from 'xml2js';
var findCollectionAttributePath = function (cmrObject, attributePath) {
    if ((0, get_1["default"])(cmrObject, attributePath)) {
        return attributePath;
    }
    var output = null;
    Object.entries(cmrObject).forEach(function (_a) {
        var key = _a[0], value = _a[1];
        if (typeof (value) === 'object') {
            var path = findCollectionAttributePath(value, attributePath);
            if (path !== null) {
                output = key + '.' + path;
            }
        }
    });
    return output;
};
var findISOCollectionAttributePath = function (cmrObject, identifierString) {
    if ((0, get_1["default"])(cmrObject, 'gmd:description.gco:CharacterString') === identifierString) {
        return 'gmd:code.gco:CharacterString';
    }
    var output = null;
    Object.entries(cmrObject).forEach(function (_a) {
        var key = _a[0], value = _a[1];
        if (typeof (value) === 'object') {
            var path = findISOCollectionAttributePath(value, identifierString);
            if (path !== null) {
                output = key + '.' + path;
            }
        }
    });
    return output;
};
var updateCMRISOCollectionValue = function (cmrObject, collection) {
    var defaultNamePath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString';
    var fullNamePath = findISOCollectionAttributePath(cmrObject, 'The ECS Short Name') || defaultNamePath;
    (0, set_1["default"])(cmrObject, fullNamePath, collection.name);
    var defaultIdPath = 'gmd:DS_Series.gmd:composedOf.gmd:DS_DataSet.gmd:has.gmi:MI_Metadata.gmd:identificationInfo.gmd:MD_DataIdentification.gmd:citation.gmd:CI_Citation.gmd:identifier.1.gmd:MD_Identifier.gmd:code.gco:CharacterString';
    var fullIdPath = findISOCollectionAttributePath(cmrObject, 'The ECS Version ID') || defaultIdPath;
    (0, set_1["default"])(cmrObject, fullIdPath, collection.version);
};
var updateCMRCollectionValue = function (cmrObject, identifierPath, value, defaultPath) {
    if (defaultPath === void 0) { defaultPath = null; }
    var backupPath = defaultPath || identifierPath;
    var fullPath = findCollectionAttributePath(cmrObject, identifierPath) || backupPath;
    (0, set_1["default"])(cmrObject, fullPath, value);
};
var uploadCMRFile = function (cmrFile, cmrObject) { return __awaiter(void 0, void 0, void 0, function () {
    var cmrFileString;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if ((0, cmr_utils_1.isUMMGFilename)(cmrFile.name || cmrFile.key)) {
                    cmrFileString = JSON.stringify(cmrObject, undefined, 2);
                }
                else {
                    cmrFileString = (0, cmr_utils_1.generateEcho10XMLString)(cmrObject);
                }
                return [4 /*yield*/, (0, S3_1.s3PutObject)({
                        Bucket: cmrFile.bucket,
                        Key: cmrFile.key,
                        Body: cmrFileString
                    })];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
exports.uploadCMRFile = uploadCMRFile;
var updateCmrFileCollections = function (_a) {
    var collection = _a.collection, cmrFileName = _a.cmrFileName, cmrObject = _a.cmrObject, files = _a.files, distEndpoint = _a.distEndpoint, bucketTypes = _a.bucketTypes, _b = _a.cmrGranuleUrlType, cmrGranuleUrlType = _b === void 0 ? 'both' : _b, distributionBucketMap = _a.distributionBucketMap;
    var params = {
        metadataObject: cmrObject,
        files: files,
        distEndpoint: distEndpoint,
        bucketTypes: bucketTypes,
        cmrGranuleUrlType: cmrGranuleUrlType,
        distributionBucketMap: distributionBucketMap
    };
    console.log('going to pass files: ', files);
    var cmrObjectCopy = (0, cloneDeep_1["default"])(cmrObject);
    if ((0, cmr_utils_1.isECHO10Filename)(cmrFileName)) {
        updateCMRCollectionValue(cmrObjectCopy, 'Collection.ShortName', collection.name, 'Granule.Collection.ShortName');
        updateCMRCollectionValue(cmrObjectCopy, 'Collection.VersionId', collection.version, 'Granule.Collection.VersionId');
        (0, cmr_utils_1.updateEcho10XMLMetadataObject)(params);
    }
    else if ((0, cmr_utils_1.isISOFilename)(cmrFileName)) {
        updateCMRISOCollectionValue(cmrObjectCopy, collection);
    }
    else if ((0, cmr_utils_1.isUMMGFilename)(cmrFileName)) {
        updateCMRCollectionValue(cmrObjectCopy, 'CollectionReference.ShortName', collection.name);
        updateCMRCollectionValue(cmrObjectCopy, 'CollectionReference.VersionId', collection.version);
        (0, cmr_utils_1.updateUMMGMetadataObject)(params);
    }
    else {
        throw new assert_1.AssertionError({ message: 'cmr file in unknown format' });
    }
    return cmrObjectCopy;
};
exports.updateCmrFileCollections = updateCmrFileCollections;
var getCMRMetadata = function (cmrFile, granuleId) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, cmrSettings, cmr, granulesOutput;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 1, , 4]);
                return [2 /*return*/, (0, cmr_utils_1.metadataObjectFromCMRFile)("s3://".concat(cmrFile.bucket, "/").concat(cmrFile.key))];
            case 1:
                _a = _b.sent();
                return [4 /*yield*/, (0, cmr_utils_1.getCmrSettings)()];
            case 2:
                cmrSettings = _b.sent();
                cmr = new CMR_1.CMR(cmrSettings);
                return [4 /*yield*/, cmr.searchGranules({ granuleId: granuleId })];
            case 3:
                granulesOutput = (_b.sent())[0];
                return [2 /*return*/, granulesOutput];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getCMRMetadata = getCMRMetadata;
function isCMRMetadataFile(file) {
    return file.type === 'metadata';
}
exports.isCMRMetadataFile = isCMRMetadataFile;
