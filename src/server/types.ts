import WebSocket from "ws";


export type Options = {
	port: number | string;
	ssl?: {
		cert: Buffer | string;
		key: Buffer | string;
	};
} & WebSocket.ServerOptions;

export type CompatibleListener = () => void;
