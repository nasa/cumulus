import Boom from 'boom';

export type ExpressRequest = import('express').Request;
export type ExpressResponse = import('express').Response;
export type ExpressNextFunction = import('express').NextFunction;
export type BoomResponse = ExpressResponse & {
  boom: { badRequest: BoomBadRequest },
};
export type BoomBadRequest = typeof Boom.badRequest;
