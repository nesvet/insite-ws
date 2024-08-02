import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import WebSocket, { WebSocketServer } from "ws";
import { requestHeaders, type RequestListener } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { CompatibleListener, Options } from "./types";
import { InSiteWebSocketServerClient } from "./WebSocketServerClient";


export class InSiteWebSocketServer extends WebSocketServer<typeof InSiteWebSocketServerClient> {
	constructor(options: Options, props?: Record<string, unknown>, handleListen?: (() => void)) {
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
			...wssOptions,
			server,
			WebSocket: InSiteWebSocketServerClient
		});
		
		this.port = typeof port == "string" ? Number.parseInt(port) : port;
		
		if (props)
			if (typeof props == "function")
				handleListen = props;
			else
				Object.assign(this, props);
		
		this.on("connection", InSiteWebSocketServer.handleConnection as CompatibleListener);
		
		this.on(`client-message:${requestHeaders.request}`, this.#handleRequest);
		
		server.listen(this.port, handleListen);
		
	}
	
	readonly isWebSocketServer = true;
	readonly isWebSocketServerClient = false;
	readonly isWebSocket = false;
	
	readonly port;
	
	#requestListeners = new Map<string, RequestListener>();
	
	addRequestListener(kind: string, listener: RequestListener) {
		this.#requestListeners.set(kind, listener);
		
		return this;
	}
	
	onRequest = this.addRequestListener;
	
	removeRequestListener(kind: string) {
		this.#requestListeners.delete(kind);
		
		return this;
	}
	
	offRequest = this.removeRequestListener;
	
	#handleRequest = async (wssc: InSiteWebSocketServerClient, id: string, kind: string, ...rest: unknown[]) => {
		const listener = this.#requestListeners.get(kind);
		
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
	
	
	static handleConnection(this: InSiteWebSocketServer, wssc: InSiteWebSocketServerClient | WebSocket, request: http.IncomingMessage) {
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
			
			const { terminate } = wssc;
			
			Object.assign(wssc, {
				isWebSocketServerClient: true,
				isWebSocketServer: false,
				isWebSocket: false,
				[defibSymbol]: InSiteWebSocketServerClient.makeDefib.call(wssc as InSiteWebSocketServerClient),
				latency: 0,
				[heartbeatIntervalSymbol]: InSiteWebSocketServerClient.makeHeartbeatInterval.call(wssc as InSiteWebSocketServerClient),
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
		
		(wssc as InSiteWebSocketServerClient)[defibSymbol]();
		
		wssc.on("message", InSiteWebSocketServer.handleClientMessage as CompatibleListener);
		wssc.on("error", InSiteWebSocketServer.handleClientError as CompatibleListener);
		wssc.on("close", InSiteWebSocketServer.handleClientClose as CompatibleListener);
		
		this.emit("client-connect", wssc, request);
		
	}
	
	
	static handleClientMessage(this: InSiteWebSocketServerClient, data: WebSocket.RawData) {
		const message = data.toString();
		
		this[defibSymbol]();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit(`message:${kind}`, ...rest);
				this.wss.emit("client-message", this, kind, ...rest);
				this.wss.emit(`client-message:${kind}`, this, ...rest);
			} catch (error) {
				InSiteWebSocketServer.handleClientError.call(this, error as Error);
			}
		else if (this[pingTsSymbol]) {
			this.latency = Date.now() - this[pingTsSymbol];
			delete this[pingTsSymbol];
		}
		
	}
	
	static handleClientError(this: InSiteWebSocketServerClient, error: Error | Event | undefined) {
		if (error instanceof Event)
			error = undefined;
		
		if (process.env.NODE_ENV === "development")
			console.error("WebSocketServer Client error", error);
		
		this.wss.emit("client-error", this, error);
		
	}
	
	static handleClientClose(this: InSiteWebSocketServerClient, ...args: unknown[]) {
		
		if (process.env.NODE_ENV === "development")
			console.info("WebSocketServer Client closed", ...args);
		
		this[defibSymbol].clear();
		clearInterval(this[heartbeatIntervalSymbol]);
		
		this.wss.emit("client-close", this);
		this.wss.emit("client-closed", this);
		
	}
	
}
