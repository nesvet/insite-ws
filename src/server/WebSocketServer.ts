import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { RawData, WebSocket, WebSocketServer } from "ws";
import { requestHeaders } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { InSiteWebSocketServerClient } from "./WebSocketServerClient";
import type { Options } from "./types";


type RequestListener<WSSC extends InSiteWebSocketServerClient> = (wscc: WSSC, ...args: any[]) => any | Promise<any>;// eslint-disable-line @typescript-eslint/no-explicit-any

declare abstract class PrepareWebSocketServer<WSSC extends InSiteWebSocketServerClient> extends WebSocketServer<typeof InSiteWebSocketServerClient> {
	on(event: "connection", callback: (this: InSiteWebSocketServer<WSSC>, socket: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "error", callback: (this: InSiteWebSocketServer<WSSC>, error: Error) => void): this;
	on(event: "headers", callback: (this: InSiteWebSocketServer<WSSC>, headers: string[], request: http.IncomingMessage) => void): this;
	on(event: "close" | "listening", callback: (this: InSiteWebSocketServer<WSSC>) => void): this;
	
	on(event: "client-connect", listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "client-error", listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, error: Error | undefined) => void): this;
	on(event: `client-${string}`, listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, ...args: any[]) => void): this;// eslint-disable-line @typescript-eslint/no-explicit-any
	
	on(event: string | symbol, listener: (this: InSiteWebSocketServer<WSSC>, ...args: any[]) => void): this;// eslint-disable-line @typescript-eslint/no-explicit-any
}


export class InSiteWebSocketServer<WSSC extends InSiteWebSocketServerClient = InSiteWebSocketServerClient> extends PrepareWebSocketServer<WSSC> {
	constructor(options: Options<WSSC>, props?: Record<string, unknown>, handleListen?: (() => void)) {
		const {
			ssl,
			port,
			...wssOptions
		} = options;
		
		if (ssl) {
			if (typeof ssl.cert == "string" && !/^-{3,}BEGIN/.test(ssl.cert))
				try {
					ssl.cert = fs.readFileSync(ssl.cert);
				} catch {}
			if (typeof ssl.key == "string" && !/^-{3,}BEGIN/.test(ssl.key))
				try {
					ssl.key = fs.readFileSync(ssl.key);
				} catch {}
		}
		
		const {
			server = ssl ? https.createServer({ ...ssl }) : http.createServer()
		} = wssOptions;
		
		super({
			WebSocket: InSiteWebSocketServerClient<WSSC>,
			...wssOptions,
			server
		});
		
		this.port = typeof port == "string" ? Number.parseInt(port) : port;
		
		if (props)
			if (typeof props == "function")
				handleListen = props;
			else
				Object.assign(this, props);
		
		this.on("connection", this.handleConnection);
		
		this.on(`client-message:${requestHeaders.request}`, this.handleRequest);
		
		server.listen(this.port, handleListen);
		
	}
	
	readonly isWebSocketServer = true;
	readonly isWebSocketServerClient = false;
	readonly isWebSocket = false;
	
	readonly port;
	
	private readonly requestListeners = new Map<string, RequestListener<WSSC>>();
	
	addRequestListener(kind: string, listener: RequestListener<WSSC>) {
		this.requestListeners.set(kind, listener);
		
		return this;
	}
	
	onRequest = this.addRequestListener;
	
	removeRequestListener(kind: string) {
		this.requestListeners.delete(kind);
		
		return this;
	}
	
	offRequest = this.removeRequestListener;
	
	private handleRequest = async (wssc: WSSC, id: string, kind: string, ...rest: unknown[]) => {
		const listener = this.requestListeners.get(kind);
		
		let result;
		let requestError = null;
		
		if (listener)
			try {
				result = await listener.call(this, wssc, ...rest);
			} catch (error) {
				if (error instanceof Error) {
					const { message, ...restProps } = error;
					requestError = { message, ...restProps };
				}
			}
		else
			requestError = { message: `Unknown request kind "${kind}"` };
		
		wssc.sendMessage(`${requestHeaders.response}-${id}`, requestError, result);
		
	};
	
	private handleConnection(wssc: WSSC, request: http.IncomingMessage) {
		if (!(wssc instanceof InSiteWebSocketServerClient)) { /* Compatibility with Bun */
			Object.defineProperties(wssc, {
				isConnecting: {
					get: Object.getOwnPropertyDescriptor(InSiteWebSocketServerClient.prototype, "isConnecting")!.get
				},
				isOpen: {
					get: Object.getOwnPropertyDescriptor(InSiteWebSocketServerClient.prototype, "isOpen")!.get
				},
				isClosing: {
					get: Object.getOwnPropertyDescriptor(InSiteWebSocketServerClient.prototype, "isClosing")!.get
				},
				isClosed: {
					get: Object.getOwnPropertyDescriptor(InSiteWebSocketServerClient.prototype, "isClosed")!.get
				}
			});
			
			const { terminate } = wssc as WebSocket;
			
			Object.assign(wssc, {
				isWebSocketServerClient: true,
				isWebSocketServer: false,
				isWebSocket: false,
				[defibSymbol]: InSiteWebSocketServerClient.makeDefib.call(wssc),
				latency: 0,
				[heartbeatIntervalSymbol]: InSiteWebSocketServerClient.makeHeartbeatInterval.call(wssc),
				sendMessage: InSiteWebSocketServerClient.prototype.sendMessage,
				sendRequest: InSiteWebSocketServerClient.prototype.sendRequest,
				terminate() { /* Workaround Bun's WebSocket#terminate bug */
					
					try {
						terminate.call(wssc);
					} catch (error) {
						console.error(error);
					}
					
				}
			});
		}
		
		Object.assign(wssc, {
			wss: this,
			userAgent: request.headers["user-agent"] ?? "",
			remoteAddress: request.headers["x-real-ip"] ?? request.headers["x-forwarded-for"] ?? ""
		});
		
		wssc[defibSymbol]();
		
		wssc.on("message", data => this.handleClientMessage(wssc, data));
		wssc.on("error", error => this.handleClientError(wssc, error));
		wssc.on("close", (...args) => this.handleClientClose(wssc, ...args));
		
		this.emit("client-connect", wssc, request);
		
	}
	
	
	private handleClientMessage(wssc: WSSC, data: RawData) {
		const message = data.toString();
		
		wssc[defibSymbol]();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				wssc.emit(`message:${kind}`, ...rest);
				this.emit("client-message", wssc, kind, ...rest);
				this.emit(`client-message:${kind}`, wssc, ...rest);
			} catch (error) {
				this.handleClientError(wssc, error as Error);
			}
		else if (wssc[pingTsSymbol]) {
			wssc.latency = Date.now() - wssc[pingTsSymbol];
			delete wssc[pingTsSymbol];
		}
		
	}
	
	private handleClientError(wssc: WSSC, error: Error | Event | undefined) {
		if (error instanceof Event)
			error = undefined;
		
		if (process.env.NODE_ENV === "development")
			console.error("WebSocketServer Client error", error);
		
		this.emit("client-error", wssc, error);
		
	}
	
	private handleClientClose(wssc: WSSC, ...args: unknown[]) {
		
		if (process.env.NODE_ENV === "development")
			console.info("WebSocketServer Client closed", ...args);
		
		wssc[defibSymbol].clear();
		clearInterval(wssc[heartbeatIntervalSymbol]);
		
		this.emit("client-close", wssc);
		this.emit("client-closed", wssc);
		
	}
	
}
