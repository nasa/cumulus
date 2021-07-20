import { createErrorType } from '@cumulus/errors';

export const NoAllowedRedirectsError = createErrorType('NoAllowedRedirects');
export const NoMatchingRedirectError = createErrorType('NoMatchingRedirect');
