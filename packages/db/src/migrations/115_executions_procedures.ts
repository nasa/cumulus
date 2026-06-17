/**
 * This is a no-op file to prevent "migration directory is corrupt" errors.
 *
 * This file exists here because it is recorded in the migration history during
 * the bootstrap process. Standard migrations require this filename to exist
 * in the directory to pass validation.
 */

exports.up = async () => {};
exports.down = async () => {};
