interface KnexError extends Error {
  code: string,
}

// Postgres error codes:
// https://www.postgresql.org/docs/10/errcodes-appendix.html
export const isCollisionError = (error: KnexError) => error.code === '23505';
