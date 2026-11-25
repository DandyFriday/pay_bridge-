export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  /**
   * Creates an operational HTTP error for predictable API error responses.
   */
  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
