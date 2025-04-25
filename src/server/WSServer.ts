import type http from "node:http";
import type https from "node:https";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { handleMongoError } from "@nesvet/n";
import {
	createServer,
	getRemoteAddress,
	resolveSSL,
	showServerListeningMessage
} from "insite-common/backend";
import { requestHeaders } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { WSServerClient } from "./WSServerClient";
import type { Options, RequestListener } from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any */


export class WSServer<WSSC extends WSServerClient = WSServerClient> extends WebSocketServer<typeof WSServerClient> {
	constructor(options: Options<WSSC>) {
		const {
			ssl: _,
			port,
			server = createServer(WSServer.makeProps(options)),
			...wssOptions
		} = options;
		
		super({
			WebSocket: WSServerClient<WSSC>,
			...wssOptions,
			server
		});
		
		this.server = server;
		
		if (options.server)
			void new Promise<void>(resolve => void (
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
		
		this.on("error", (error: Error) => console.error(`${this.icon}❗️ WS Server:`, error));
		
		this.on("close", () => console.error(`${this.icon}❗️ WS Server closed`));
		
	}
	
	on(event: "connection", callback: (this: WSServer<WSSC>, socket: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "error", callback: (this: WSServer<WSSC>, error: Error) => void): this;
	on(event: "headers", callback: (this: WSServer<WSSC>, headers: string[], request: http.IncomingMessage) => void): this;
	on(event: "close" | "listening", callback: (this: WSServer<WSSC>) => void): this;
	
	on(event: "client-connect", listener: (this: WSServer<WSSC>, wscc: WSSC, request: http.IncomingMessage) => void): this;
	on(event: "client-error", listener: (this: WSServer<WSSC>, wscc: WSSC, error: Error | undefined) => void): this;
	on(event: `client-${string}`, listener: (this: WSServer<WSSC>, wscc: WSSC, ...args: any[]) => void): this;
	
	on(event: string | symbol, listener: (this: WSServer<WSSC>, ...args: any[]) => void): this;
	on(event: string | symbol, listener: (this: WSServer<WSSC>, ...args: any[]) => void): this {
		return super.on(event, listener as unknown as (this: WebSocketServer, ...args: any[]) => void);
	}
	
	readonly isWebSocketServer = true;
	readonly isWebSocketServerClient = false;
	readonly isWebSocket = false;
	
	icon = "🔌";
	name = "WS";
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
				if (process.env.NODE_ENV === "development")
					handleMongoError(error);
				
				if (error instanceof Error) {
					const { message, ...restProps } = error;
					requestError = { message, ...restProps };
				}
				
				if (process.env.NODE_ENV === "development")
					console.error(`${this.icon}❗️ WS Server request "${kind}" (${id}):`, error);
			}
		else
			requestError = { message: `Unknown request kind "${kind}"` };
		
		wssc.sendMessage(`${requestHeaders.response}-${id}`, requestError, result);
		
	};
	
	#handleConnection(wssc: WSSC, request: http.IncomingMessage) {
		if (!(wssc instanceof WSServerClient)) { /* Compatibility with Bun */
			Object.defineProperties(wssc, {
				isConnecting: {
					get: Object.getOwnPropertyDescriptor(WSServerClient.prototype, "isConnecting")!.get
				},
				isOpen: {
					get: Object.getOwnPropertyDescriptor(WSServerClient.prototype, "isOpen")!.get
				},
				isClosing: {
					get: Object.getOwnPropertyDescriptor(WSServerClient.prototype, "isClosing")!.get
				},
				isClosed: {
					get: Object.getOwnPropertyDescriptor(WSServerClient.prototype, "isClosed")!.get
				}
			});
			
			const { terminate } = wssc as WebSocket;
			
			Object.assign(wssc, {
				isWebSocketServerClient: true,
				isWebSocketServer: false,
				isWebSocket: false,
				[defibSymbol]: WSServerClient.makeDefib.call(wssc),
				latency: 0,
				[heartbeatIntervalSymbol]: WSServerClient.makeHeartbeatInterval.call(wssc),
				sendMessage: WSServerClient.prototype.sendMessage,
				sendRequest: WSServerClient.prototype.sendRequest,
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
		
		void wssc[defibSymbol]();
		
		wssc.on("message", data => this.#handleClientMessage(wssc, data));
		wssc.on("error", error => this.#handleClientError(wssc, error));
		wssc.on("close", (...args) => this.#handleClientClose(wssc, ...args));
		
		this.emit("client-connect", wssc, request);
		
		if (process.env.NODE_ENV === "development")
			console.info(
				`${this.icon} WS Server:`,
				"user" in wssc ? `\x1B[1m${(wssc.user as { email: string }).email}\x1B[0m` : "\x1B[3manonymous\x1B[0m",
				"connected"
			);
		
		
	}
	
	
	#handleClientMessage(wssc: WSSC, data: RawData) {
		const message = data.toString();// eslint-disable-line @typescript-eslint/no-base-to-string
		
		void wssc[defibSymbol]();
		
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
		
		console.error(
			`${this.icon}❗️ WS Server client`,
			"user" in wssc ? `\x1B[1m${(wssc.user as { email: string }).email}\x1B[0m:` : "\x1B[3manonymous\x1B[0m:",
			error
		);
		
		this.emit("client-error", wssc, error);
		
	}
	
	#handleClientClose(wssc: WSSC, code: number, reason: Buffer) {
		
		if (process.env.NODE_ENV === "development") {
			const reasonString = reason.toString();
			
			console.info(
				`${this.icon} WS Server:`,
				"user" in wssc ? `\x1B[1m${(wssc.user as { email: string }).email}\x1B[0m` : "\x1B[3manonymous\x1B[0m",
				`disconnected ${code ? `with code ${code}` : ""} ${code && reasonString ? "and " : ""}${reasonString ? `reason "${reasonString}"` : ""}`
			);
		}
		
		void wssc[defibSymbol].clear();
		clearInterval(wssc[heartbeatIntervalSymbol]);
		
		this.emit("client-close", wssc);
		this.emit("client-closed", wssc);
		
	}
	
	
	static makeProps<SWSSC extends WSServerClient>({ ssl }: Options<SWSSC>): http.ServerOptions | https.ServerOptions {
		return {
			...resolveSSL(ssl)
		};
	}
	
}
