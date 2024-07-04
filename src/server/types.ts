import http from "node:http";
import https from "node:https";
import WebSocket from "ws";


export type Options = {
	ssl?: {
		cert: string;
		key: string;
	};
	port: number;
	server?: http.Server | https.Server;
} & WebSocket.ServerOptions;

export type CompatibleListener = () => void;
