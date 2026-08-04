/**
 * Minimal structural types for the express router Directus hands to an endpoint.
 *
 * Declared locally rather than pulled in from `@types/express`: the extension
 * needs four methods and a handful of response helpers, and this keeps the
 * project typechecking with no extra dependency.
 */

export interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  flushHeaders?: () => void;
}

export type RequestLike = any;

export type RouteHandler = (
  req: RequestLike,
  res: ResponseLike,
  next: (err?: unknown) => void
) => unknown | Promise<unknown>;

export interface Router {
  use(handler: RouteHandler): unknown;
  get(path: string, handler: RouteHandler): unknown;
  post(path: string, handler: RouteHandler): unknown;
  patch?(path: string, handler: RouteHandler): unknown;
  delete(path: string, handler: RouteHandler): unknown;
}
