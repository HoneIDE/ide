/**
 * Type declarations for Perry runtime modules.
 * Perry provides extended node-fetch and ws at compile time.
 */

// Perry's node-fetch provides native SSE streaming
declare module 'node-fetch' {
  export function streamStart(url: string, method: string, body: string, headersJson: string): number;
  export function streamPoll(handle: number): string;
  export function streamStatus(handle: number): number;
  export function streamClose(handle: number): void;
}

// Perry's ws module — WebSocket handles are opaque numbers
declare module 'ws' {
  /** Create a WebSocket connection. Returns a promise-like with .then(). */
  class WebSocket {
    constructor(url: string);
    then(onFulfilled: (ws: number) => void, onRejected?: (err: unknown) => void): void;
  }
  export default WebSocket;
  export function sendToClient(ws: number, data: string): void;
  export function closeClient(ws: number): void;
  export function isOpen(ws: number): number;
  export function messageCount(ws: number): number;
  export function receive(ws: number): string;
}
