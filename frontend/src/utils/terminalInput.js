// xterm.js can emit terminal query responses through onData. If those responses
// reach a shell prompt, their ESC/CSI prefix may be swallowed and the visible
// tail (for example "0;276;0c") gets inserted as user input.
const DEVICE_ATTRIBUTE_RESPONSE_RE = /^(?:\x1b\[(?:\?[0-9;]*|>[0-9;]*)c)+$/;
const XTERM_SECONDARY_DA_VISIBLE_TAIL_RE = /^(?:0;276;0c)+$/;

export const isTerminalAutoResponse = (data) => (
  typeof data === 'string'
  && (DEVICE_ATTRIBUTE_RESPONSE_RE.test(data) || XTERM_SECONDARY_DA_VISIBLE_TAIL_RE.test(data))
);
