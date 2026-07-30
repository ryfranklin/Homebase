// Server-sent events helpers.

export function sseEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
