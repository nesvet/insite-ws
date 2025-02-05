import type { ServerOptions } from "ws";
import type { InSiteWebSocketServerClient } from "./WebSocketServerClient";


/* eslint-disable @typescript-eslint/no-explicit-any */


export type Options<WSSC extends InSiteWebSocketServerClient> = Omit<ServerOptions<typeof InSiteWebSocketServerClient>, "port"> & {
	ssl?: {
		cert: Buffer | string;
		key: Buffer | string;
	};
	port?: number | string;
	WebSocket?: typeof InSiteWebSocketServerClient & {
		new (...args: any[]): WSSC;
	};
};

export type RequestListener<WSSC extends InSiteWebSocketServerClient> = (wscc: WSSC, ...args: any[]) => any | Promise<any>;

export type CompatibleListener = () => void;
