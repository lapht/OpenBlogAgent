/** An error with the HTTP status and stable code the client sees. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}
