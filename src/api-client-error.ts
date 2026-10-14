export class ApiClientError extends Error {
  constructor(message: string, readonly kind: string = "api", readonly httpStatus?: number) {
    super(message);
    this.name = "ApiClientError";
  }
}
