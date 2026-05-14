export interface SimpleLogger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export function wrapLogger(directusLogger: any): SimpleLogger {
  if (!directusLogger) {
    return {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }
  return {
    info: (...args: any[]) => directusLogger.info?.(...args),
    warn: (...args: any[]) => directusLogger.warn?.(...args),
    error: (...args: any[]) => directusLogger.error?.(...args),
  };
}
