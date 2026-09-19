export class ApiError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public details?: unknown;
  /**
   * Stable machine-readable code for errors the caller may want to branch on
   * (e.g. "DATA_PLAN_REQUIRED" bubbled up from jestatp-broker-service),
   * independent of the human-readable `message`. Undefined for ordinary
   * ApiErrors, which callers should keep handling via statusCode/message.
   */
  public errorCode?: string;

  constructor(statusCode: number, message: string, details?: unknown, isOperational = true, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ApiError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }
  static conflict(message: string) {
    return new ApiError(409, message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, undefined, false);
  }
}
