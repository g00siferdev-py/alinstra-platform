const SENSITIVE_KEY =
  /email|phone|transcript|password|token|secret|authorization|cookie|body|ip/i;

type LooseRecord = Record<string, unknown>;

function scrubValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry));
  if (value && typeof value === "object") return scrubRecord(value as LooseRecord);
  return value;
}

function scrubRecord(record: LooseRecord): LooseRecord {
  const next: LooseRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY.test(key)) {
      next[key] = "[redacted]";
      continue;
    }
    next[key] = scrubValue(value, key);
  }
  return next;
}

export type SentryLikeEvent = {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    query_string?: unknown;
  };
  user?: {
    email?: string;
    ip_address?: string;
    username?: string;
    id?: string;
  };
  extra?: LooseRecord;
  contexts?: LooseRecord;
  breadcrumbs?: Array<{ data?: LooseRecord; message?: string }>;
};

/** Drop bodies and anything that could carry phone numbers, emails, or transcripts. */
export function scrubSentryEvent<T extends SentryLikeEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    event.request.cookies = undefined;
    event.request.query_string = undefined;
    if (event.request.headers) {
      const headers = { ...event.request.headers };
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_KEY.test(key)) delete headers[key];
      }
      event.request.headers = headers;
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  if (event.extra) event.extra = scrubRecord(event.extra);
  if (event.contexts) event.contexts = scrubRecord(event.contexts);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? "[redacted]" : crumb.message,
      data: crumb.data ? (scrubRecord(crumb.data) as LooseRecord) : crumb.data,
    }));
  }
  return event;
}

type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, msg: string, fields: LooseRecord = {}): void {
  const line = {
    time: new Date().toISOString(),
    level,
    msg,
    ...scrubRecord(fields),
  };
  const write = level === "error" ? console.error : console.log;
  write(JSON.stringify(line));
}
