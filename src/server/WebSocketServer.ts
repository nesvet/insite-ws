import type http from "node:http";
import type https from "node:https";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { createServer, resolveSSL, showServerListeningMessage } from "insite-common/backend";
import { requestHeaders } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { getRemoteAddress } from "./utils";
import { InSiteWebSocketServerClient } from "./WebSocketServerClient";
import type { Options, RequestListener } from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any */


export class InSiteWebSocketServer<WSSC extends InSiteWebSocketServerClient = InSiteWebSocketServerClient> extends WebSocketServer<typeof InSiteWebSocketServerClient> {
	constructor(options: Options<WSSC>) {
		const {
			ssl: _,
			port,
			server = createServer(InSiteWebSocketServer.makeProps(options)),
			...wssOptions
		} = options;
		
		super({
			WebSocket: InSiteWebSocketServerClient<WSSC>,
			...wssOptions,
			server
		});
		
		this.server = server;
		
		if (options.server)
			new Promise<void>(resolve => void (
				server.listening ?
					resolve() :
					server.on("listening", resolve)
			)).then(() => showServerListeningMessage(this));
		else
			this.server.listen(
				typeof port == "string" ?
					Number.parseInt(port) :
					port ?? (this.isS ? 443 : 80),
				() => showServerListeningMessage(this)
			);
		
		this.on("connection", this.#handleConnection);
		
		this.on(`client-message:${requestHeaders.request}`, this.#handleRequest);
		
	}
	
	on(event: "connection", callback: (this: InSiteWebSocketServer<WSSC>, socket: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "error", callback: (this: InSiteWebSocketServer<WSSC>, error: Error) => void): this;
	on(event: "headers", callback: (this: InSiteWebSocketServer<WSSC>, headers: string[], request: http.IncomingMessage) => void): this;
	on(event: "close" | "listening", callback: (this: InSiteWebSocketServer<WSSC>) => void): this;
	
	on(event: "client-connect", listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "client-error", listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, error: Error | undefined) => void): this;
	on(event: `client-${string}`, listener: (this: InSiteWebSocketServer<WSSC>, wscc: WSSC, ...args: any[]) => void): this;
	
	on(event: string | symbol, listener: (this: InSiteWebSocketServer<WSSC>, ...args: any[]) => void): this;
	on(event: string | symbol, listener: (this: InSiteWebSocketServer<WSSC>, ...args: any[]) => void): this {
		return super.on(event, listener as unknown as (this: WebSocketServer, ...args: any[]) => void);
	}
	
	readonly isWebSocketServer = true;
	readonly isWebSocketServerClient = false;
	readonly isWebSocket = false;
	
	icon = "🔌";
	name = "WebSocket";
	get protocol() {
		return `ws${this.isS ? "s" : ""}`;
	}
	
	server;
	
	get isS() {
		return "setSecureContext" in this.server;
	}
	
	#requestListeners = new Map<string, RequestListener<WSSC>>();
	
	addRequestListener(kind: string, listener: RequestListener<WSSC>) {
		this.#requestListeners.set(kind, listener);
		
		return this;
	}
	
	onRequest = this.addRequestListener;
	
	removeRequestListener(kind: string) {
		this.#requestListeners.delete(kind);
		
		return this;
	}
	
	offRequest = this.removeRequestListener;
	
	#handleRequest = async (wssc: WSSC, id: string, kind: string, ...rest: unknown[]) => {
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
				if (process.env.NODE_ENV === "development")
					console.error(`WebSocketServer request "${kind}" (${id}) error: `, error);
			}
		else
			requestError = { message: `Unknown request kind "${kind}"` };
		
		wssc.sendMessage(`${requestHeaders.response}-${id}`, requestError, result);
		
	};
	
	#handleConnection(wssc: WSSC, request: http.IncomingMessage) {
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
			remoteAddress: getRemoteAddress(request)
		});
		
		wssc[defibSymbol]();
		
		wssc.on("message", data => this.#handleClientMessage(wssc, data));
		wssc.on("error", error => this.#handleClientError(wssc, error));
		wssc.on("close", (...args) => this.#handleClientClose(wssc, ...args));
		
		this.emit("client-connect", wssc, request);
		
	}
	
	
	#handleClientMessage(wssc: WSSC, data: RawData) {
		const message = data.toString();
		
		wssc[defibSymbol]();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				wssc.emit(`message:${kind}`, ...rest);
				this.emit("client-message", wssc, kind, ...rest);
				this.emit(`client-message:${kind}`, wssc, ...rest);
			} catch (error) {
				this.#handleClientError(wssc, error as Error);
			}
		else if (wssc[pingTsSymbol]) {
			wssc.latency = Date.now() - wssc[pingTsSymbol];
			delete wssc[pingTsSymbol];
		}
		
	}
	
	#handleClientError(wssc: WSSC, error: Error | Event | undefined) {
		if (error instanceof Event)
			error = undefined;
		
		if (process.env.NODE_ENV === "development")
			console.error("WebSocketServer Client error", error);
		
		this.emit("client-error", wssc, error);
		
	}
	
	#handleClientClose(wssc: WSSC, code: number, reason: Buffer) {
		
		if (process.env.NODE_ENV === "development")
			console.info(`WebSocketServer Client closed ${code ? `with code ${code}` : ""} ${code && reason ? "and " : ""}${reason ? `reason "${reason.toString()}"` : ""}`);
		
		wssc[defibSymbol].clear();
		clearInterval(wssc[heartbeatIntervalSymbol]);
		
		this.emit("client-close", wssc);
		this.emit("client-closed", wssc);
		
	}
	
	
	static makeProps<SWSSC extends InSiteWebSocketServerClient>({ ssl }: Options<SWSSC>): http.ServerOptions | https.ServerOptions {
		return {
			...resolveSSL(ssl)
		};
	}
	
}
