export interface AppConfig {
  env: string;
  port: number;
  host: string;
  debug: boolean;
  version: string;
}

export interface ServerOptions {
  port: number;
  host: string;
  cors: boolean;
  logging: boolean;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: Request) => Response | Promise<Response>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
