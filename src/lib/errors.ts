import type { ApiError } from "./types";

export class ApiErrorLike extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
  toApiError(): ApiError {
    return { code: this.code, message: this.message };
  }
}

const CLIENT_CODES = new Set([
  "BadRequest",
  "ModelDisabled",
  "UnknownModel",
  "MissingConfig",
  "PolicyViolation",
]);

export function errorStatus(err: ApiErrorLike): number {
  return CLIENT_CODES.has(err.code) ? 400 : 500;
}
