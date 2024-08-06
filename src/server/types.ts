import type { ServerOptions } from "ws";
import type { InSiteWebSocketServerClient } from "./WebSocketServerClient";


export type Options<WSSC extends InSiteWebSocketServerClient> = {
	port: number | string;
	ssl?: {
		cert: Buffer | string;
		key: Buffer | string;
	};
	WebSocket?: {
		new (...args: any[]): WSSC;// eslint-disable-line @typescript-eslint/no-explicit-any
	} & typeof InSiteWebSocketServerClient;
} & Omit<ServerOptions, "port">;

export type CompatibleListener = () => void;
