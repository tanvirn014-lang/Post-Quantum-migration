import { DomainError } from "../domain/errors.js";

export class InvalidCredentialsError extends DomainError {
  constructor() {
    // Deliberately identical for unknown user, wrong password, disabled and locked accounts.
    super("Invalid credentials", "INVALID_CREDENTIALS");
  }
}

export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super("Authentication is required", "AUTH_REQUIRED");
  }
}

export class InvalidTokenError extends DomainError {
  constructor() {
    super("The access token is invalid or expired", "INVALID_TOKEN");
  }
}

export class InvalidRefreshTokenError extends DomainError {
  constructor() {
    super("The refresh token is invalid or expired", "INVALID_REFRESH_TOKEN");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, "FORBIDDEN");
  }
}

export class PasswordChangeRequiredError extends DomainError {
  constructor() {
    super("The password must be changed before continuing", "PASSWORD_CHANGE_REQUIRED");
  }
}

export class WeakPasswordError extends DomainError {
  constructor(public readonly problems: string[]) {
    super(`Password does not meet the policy: ${problems.join("; ")}`, "WEAK_PASSWORD");
  }
}

export class CurrentPasswordIncorrectError extends DomainError {
  constructor() {
    super("The current password is incorrect", "CURRENT_PASSWORD_INCORRECT");
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super("That email address is already registered", "EMAIL_ALREADY_REGISTERED");
  }
}

export class UserNotFoundError extends DomainError {
  constructor(id: string) {
    super(`User ${id} does not exist`, "USER_NOT_FOUND");
  }
}

export class CustomerNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Customer ${id} does not exist`, "CUSTOMER_NOT_FOUND");
  }
}

export class OriginNotAllowedError extends DomainError {
  constructor() {
    super("The request origin is not allowed", "ORIGIN_NOT_ALLOWED");
  }
}
