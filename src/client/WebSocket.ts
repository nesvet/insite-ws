import EventEmitter from "eventemitter3";
import { debounce, noop, uid } from "@nesvet/n";
import { heartbeatGap, heartbeatInterval, requestHeaders } from "../common";


const reconnectTimeout = 2000;

let i = 0;

const webSocketUrlMap = new WeakMap<WebSocket, string | URL>();

export type Options = {
	url?: string | URL;
	name?: string;
	protocols?: string[];
	immediately?: boolean;
	autoReconnect?: boolean;
	on?: Record<string, (...args: any[]) => void>;// eslint-disable-line @typescript-eslint/no-explicit-any
};

type RequestListener = (...args: any[]) => any | Promise<any>;// eslint-disable-line @typescript-eslint/no-explicit-any


export class InSiteWebSocket extends EventEmitter {
	constructor(options: Options = {}) {
		super();
		
		const {
			url,
			name = (i++).toString(),
			protocols,
			immediately = true,
			autoReconnect = true,
			on
		} = options;
		
		this.url = url;
		this.name = name;
		
		this.protocols = protocols;
		
		this.autoReconnect = !!autoReconnect;
		
		this.on(`message:${requestHeaders.request}`, this.handleRequest);
		
		if (on)
			for (const eventName in on)
				if (on[eventName])
					this.on(eventName, on[eventName]);
		
		if (this.url && immediately)
			this.open().catch(noop);
		
	}
	
	readonly isWebSocket = true;
	readonly isWebSocketServer = false;
	readonly isWebSocketServerClient = false;
	
	url;
	
	readonly name;
	
	protocols?;
	
	autoReconnect;
	
	send?(data: ArrayBufferLike | ArrayBufferView | Blob | string): void;
	
	webSocket: null | WebSocket = null;
	
	private defib = debounce(InSiteWebSocket.defib, heartbeatInterval + heartbeatGap);
	
	get isConnecting() {
		return this.webSocket ? this.webSocket.readyState === this.webSocket.CONNECTING : null;
	}
	
	get isOpen() {
		return this.webSocket ? this.webSocket.readyState === this.webSocket.OPEN : null;
	}
	
	get isClosing() {
		return this.webSocket ? this.webSocket.readyState === this.webSocket.CLOSING : null;
	}
	
	get isClosed() {
		return this.webSocket ? this.webSocket.readyState === this.webSocket.CLOSED : null;
	}
	
	private openResolve?: () => void;
	private openReject?: (reason?: unknown) => void;
	
	private handleWebSocketOpen = () => {
		
		this.openResolve!();
		delete this.openResolve;
		delete this.openReject;
		
		this.emit("open");
		
		this.defib();
		
	};
	
	private handleWebSocketMessage = ({ data: message }: MessageEvent) => {
		
		this.defib();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit("message", kind, ...rest);
				this.emit(`message:${kind}`, ...rest);
			} catch (error) {
				this.handleWebSocketError(error as Error);
			}
		else
			this.webSocket!.send("");
		
	};
	
	private handleWebSocketError = (error: Error | Event | undefined) => {
		if (error instanceof Event)
			error = undefined;
		
		if (this.openReject) {
			this.openReject(error);
			delete this.openResolve;
			delete this.openReject;
		}
		
		this.emit("error", error);
		
	};
	
	private reconnectTimeout?: number;
	
	private handleWebSocketClose = (event: CloseEvent) => {
		
		if (process.env.NODE_ENV === "development")
			console.info(`WebSocket ${this.name} is closed with code ${event.code} and reason "${event.reason}"`);
		
		this.defib.clear();
		
		this.emit("close", event);
		
		if (this.autoReconnect && ![ 1002, 3500, 4000 ].includes(event.code)) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} will try to reconnect in 2 sec…`);
			
			this.reconnectTimeout = setTimeout(() => this.open().catch(noop), reconnectTimeout) as unknown as number;
		}
		
	};
	
	async open(options: Options = {}): Promise<void> {
		
		clearTimeout(this.reconnectTimeout);
		
		await this.close(4000, "reopen");
		
		if (options.url)
			this.url = options.url;
		
		if (options.protocols)
			this.protocols = options.protocols;
		
		if (this.webSocket && webSocketUrlMap.get(this.webSocket) !== this.url)
			this.emit("server-change");
		
		return new Promise((resolve, reject) => {
			if (this.url) {
				this.openResolve = resolve;
				this.openReject = reject;
				
				this.webSocket = new WebSocket(this.url, this.protocols);
				
				this.webSocket.addEventListener("open", this.handleWebSocketOpen);
				this.webSocket.addEventListener("message", this.handleWebSocketMessage);
				this.webSocket.addEventListener("error", this.handleWebSocketError);
				this.webSocket.addEventListener("close", this.handleWebSocketClose);
				
				this.send = this.webSocket.send.bind(this.webSocket);
				
				webSocketUrlMap.set(this.webSocket, this.url);
				
				this.emit("connecting");
			} else {
				this.webSocket = null;
				delete this.send;
				reject(new Error("url prop is not set"));
			}
			
		});
	}
	
	connect = this.open;
	
	close(code = 3500, reason = "manual") {
		
		clearTimeout(this.reconnectTimeout);
		
		return new Promise(resolve => {
			if (this.isConnecting || this.isOpen) {
				this.webSocket!.addEventListener("close", resolve);
				this.webSocket!.close(code, reason);
			} else
				resolve(null);
			
		});
	}
	
	disconnect = this.close;
	
	private queue: string[] = [];
	
	private releaseQueue = () => {
		
		for (const message of this.queue)
			this.webSocket!.send(message);
		
		this.queue.length = 0;
		
	};
	
	sendMessage(...args: unknown[]) {
		const message = JSON.stringify(args);
		
		if (this.isOpen)
			this.webSocket!.send(message);
		else {
			if (!this.queue.length)
				this.once("open", this.releaseQueue);
			
			this.queue.push(message);
		}
		
	}
	
	sendRequest(...args: unknown[]) {
		
		const id = uid();
		const eventName = `message:${requestHeaders.response}-${id}`;
		
		if (typeof args.at(-1) == "function") {
			this.once(eventName, args.splice(-1, 1)[0] as () => void);
			this.sendMessage(requestHeaders.request, id, ...args);
			
			return this;
		}
		
		return new Promise((resolve, reject) => {
			
			this.once(eventName, (error, result) => {
				if (error) {
					const { message, ...restProps } = error;
					reject(Object.assign(new Error(message), restProps));
				} else
					resolve(result);
				
			});
			this.sendMessage(requestHeaders.request, id, ...args);
			
		});
	}
	
	private requestListeners = new Map<string, RequestListener>();
	
	addRequestListener(kind: string, listener: RequestListener) {
		this.requestListeners.set(kind, listener);
		
		return this;
	}
	
	onRequest = this.addRequestListener;
	
	removeRequestListener(kind: string) {
		this.requestListeners.delete(kind);
		
		return this;
	}
	
	offRequest = this.removeRequestListener;
	
	private handleRequest = async (id: string, kind: string, ...rest: unknown[]) => {
		const listener = this.requestListeners.get(kind);
		
		let result;
		let requestError = null;
		
		if (listener)
			try {
				result = await listener.apply(this, rest);
			} catch (error) {
				if (error instanceof Error) {
					const { message, ...restProps } = error;
					requestError = { message, ...restProps };
				}
			}
		else
			requestError = { message: `Unknown request kind "${kind}"` };
		
		this.sendMessage(`${requestHeaders.response}-${id}`, requestError, result);
		
	};
	
	
	static defib(this: InSiteWebSocket) {
		
		if (this.isOpen) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} has no heartbeat - going offline`);
			
			this.webSocket!.close();
		}
		
	}
	
}
