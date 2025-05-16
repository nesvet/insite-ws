import WebSocket from "ws";


declare global {
	var WebSocket: typeof WebSocket;// eslint-disable-line no-var, @typescript-eslint/naming-convention, no-shadow
}

globalThis.WebSocket = WebSocket as any;// eslint-disable-line @typescript-eslint/no-explicit-any
