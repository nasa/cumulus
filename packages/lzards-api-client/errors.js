"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetAuthTokenError = void 0;
// eslint-disable-next-line max-classes-per-file
class GetAuthTokenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GetAuthTokenError';
        Error.captureStackTrace(this, GetAuthTokenError);
    }
}
exports.GetAuthTokenError = GetAuthTokenError;
//# sourceMappingURL=errors.js.map