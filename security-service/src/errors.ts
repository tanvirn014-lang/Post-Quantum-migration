export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super("Authentication is required", "AUTH_REQUIRED", 401);
  }
}
export class InvalidTokenError extends DomainError {
  constructor() {
    super("The access token is invalid or expired", "INVALID_TOKEN", 401);
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, "FORBIDDEN", 403);
  }
}
export class InvalidServiceTokenError extends DomainError {
  constructor() {
    super("Invalid service credentials", "INVALID_SERVICE_TOKEN", 401);
  }
}
export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} was not found`, "NOT_FOUND", 404);
  }
}
export class ConflictError extends DomainError {
  constructor(message: string, code = "CONFLICT") {
    super(message, code, 409);
  }
}
export class ValidationFailedError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}
export class DependencyUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, "DEPENDENCY_UNAVAILABLE", 503);
  }
}
