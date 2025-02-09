import type { ServerOptions } from "ws";
import type { WSServerClient } from "./WSServerClient";


/* eslint-disable @typescript-eslint/no-explicit-any */


export type Options<WSSC extends WSServerClient> = Omit<ServerOptions<typeof WSServerClient>, "port"> & {
	ssl?: {
		cert: Buffer | string;
		key: Buffer | string;
	};
	port?: number | string;
	WebSocket?: typeof WSServerClient & {
		new (...args: any[]): WSSC;
	};
};

export type RequestListener<WSSC extends WSServerClient> = (wscc: WSSC, ...args: any[]) => any | Promise<any>;

export type CompatibleListener = () => void;
