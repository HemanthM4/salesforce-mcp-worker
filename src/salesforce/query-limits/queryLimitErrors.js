export class QueryLimitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = false;
    this.details = details;
  }
}

export class QueryTooLongError extends QueryLimitError {
  constructor(message, details) {
    super("QUERY_TOO_LONG", message, details);
  }
}

export class QueryRecordLimitError extends QueryLimitError {
  constructor(message, details) {
    super("QUERY_RECORD_LIMIT_EXCEEDED", message, details);
  }
}

export class QueryFieldLimitError extends QueryLimitError {
  constructor(message, details) {
    super("QUERY_FIELD_LIMIT_EXCEEDED", message, details);
  }
}

export class QueryMoreNotAllowedError extends QueryLimitError {
  constructor(message, details) {
    super("QUERY_MORE_NOT_ALLOWED", message, details);
  }
}
