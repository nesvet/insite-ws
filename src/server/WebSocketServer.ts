import http from "node:http";
import https from "node:https";
import WebSocket, { WebSocketServer } from "ws";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { CompatibleListener, Options } from "./types";
import { InSiteWebSocketServerClient } from "./WebSocketServerClient";


export class InSiteWebSocketServer extends WebSocketServer<typeof InSiteWebSocketServerClient> {
	constructor(options: Options, props?: Record<string, unknown>, handleListen?: (() => void)) {
		const {
			ssl,
			port,
			server = ssl ? https.createServer({ ...ssl }) : http.createServer(),
			...wssOptions
		} = options;
		
		super({
			...wssOptions,
			WebSocket: InSiteWebSocketServerClient,
			server
		});
		
		if (props)
			if (typeof props == "function")
				handleListen = props;
			else
				Object.assign(this, props);
		
		this.on("connection", InSiteWebSocketServer.handleConnection as CompatibleListener);
		
		server.listen(port, handleListen);
		
	}
	
	readonly isWebSocketServer = true;
	readonly isWebSocketServerClient = false;
	readonly isWebSocket = false;
	
	
	static handleConnection(this: InSiteWebSocketServer, ws: InSiteWebSocketServerClient | WebSocket, request: http.IncomingMessage) {
		if (!(ws instanceof InSiteWebSocketServerClient)) { /* Compatibility with Bun */
			Object.defineProperties(ws, {
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
			
			const { terminate } = ws;
			
			Object.assign(ws, {
				isWebSocketServerClient: true,
				isWebSocketServer: false,
				isWebSocket: false,
				[defibSymbol]: InSiteWebSocketServerClient.makeDefib.call(ws as InSiteWebSocketServerClient),
				latency: 0,
				[heartbeatIntervalSymbol]: InSiteWebSocketServerClient.makeHeartbeatInterval.call(ws as InSiteWebSocketServerClient),
				sendMessage: InSiteWebSocketServerClient.prototype.sendMessage,
				terminate() { /* Workaround Bun's WebSocket#terminate bug */
					
					try {
						terminate.call(ws);
					} catch (error) {
						console.error(error);
					}
					
				}
			});
		}
		
		Object.assign(ws, {
			wss: this,
			userAgent: request.headers["user-agent"],
			remoteAddress: request.headers["x-real-ip"] ?? request.headers["x-forwarded-for"] ?? "127.0.0.1"
		});
		
		(ws as InSiteWebSocketServerClient)[defibSymbol]();
		
		ws.on("message", InSiteWebSocketServer.handleClientMessage as CompatibleListener);
		ws.on("error", InSiteWebSocketServer.handleClientError as CompatibleListener);
		ws.on("close", InSiteWebSocketServer.handleClientClose as CompatibleListener);
		
		this.emit("client-connect", ws, request);
		
	}
	
	
	static handleClientMessage(this: InSiteWebSocketServerClient, data: WebSocket.RawData) {
		const message = data.toString();
		
		this[defibSymbol]();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit(`message:${kind}`, ...rest);
				this.wss!.emit("client-message", this, kind, ...rest);
				this.wss!.emit(`client-message:${kind}`, this, ...rest);
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
		
		this.wss!.emit("client-error", this, error);
		
	}
	
	static handleClientClose(this: InSiteWebSocketServerClient, ...args: unknown[]) {
		
		if (process.env.NODE_ENV === "development")
			console.info("WebSocketServer Client closed", ...args);
		
		this[defibSymbol].clear();
		clearInterval(this[heartbeatIntervalSymbol]);
		
		this.wss!.emit("client-close", this);
		this.wss!.emit("client-closed", this);
		
	}
	
}
