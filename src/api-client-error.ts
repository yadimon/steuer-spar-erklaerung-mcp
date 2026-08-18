export class ApiClientError extends Error {
  constructor(message: string, readonly kind: string = "api") {
    super(message);
    this.name = "ApiClientError";
  }
}
