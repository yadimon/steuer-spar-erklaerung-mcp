export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly kind: string = "api",
    readonly httpStatus?: number,
    readonly operationResponseReceived = false,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  withOperationResponse(received: boolean): ApiClientError {
    return received && !this.operationResponseReceived
      ? new ApiClientError(this.message, this.kind, this.httpStatus, true)
      : this;
  }
}
