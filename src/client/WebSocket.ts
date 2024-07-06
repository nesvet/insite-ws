import EventEmitter from "eventemitter3";
import { debounce, noop } from "@nesvet/n";
import { heartbeatGap, heartbeatInterval } from "../common";
import { Options } from "./types";


const reconnectTimeout = 2000;

let i = 0;

const webSocketUrlWeakMap = new WeakMap<WebSocket, string>();


export class InSiteWebSocket extends EventEmitter {
	constructor(url: string, options: Options = {}) {
		super();
		
		this.url = url;
		
		const {
			name = (i++).toString(),
			protocols,
			immediately = true,
			autoReconnect = true,
			on
		} = options;
		
		this.name = name;
		
		this.protocols = protocols;
		
		this.autoReconnect = !!autoReconnect;
		
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
	
	url: string;
	
	name: string;
	
	protocols?: string[];
	
	autoReconnect: boolean;
	
	send?(data: ArrayBufferLike | ArrayBufferView | Blob | string): void;
	
	webSocket: null | WebSocket = null;
	
	#defib = debounce(InSiteWebSocket.defib, heartbeatInterval + heartbeatGap);
	
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
	
	#openResolve?: (value?: unknown) => void;
	#openReject?: (reason?: unknown) => void;
	
	#handleWebSocketOpen = () => {
		
		this.#openResolve!();
		this.#openResolve = undefined;
		this.#openReject = undefined;
		
		this.emit("open");
		
		this.#defib();
		
	};
	
	#handleWebSocketMessage = ({ data: message }: MessageEvent) => {
		
		this.#defib();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit("message", kind, ...rest);
				this.emit(`message:${kind}`, ...rest);
			} catch (error) {
				this.#handleWebSocketError(error as Error);
			}
		else
			this.webSocket!.send("");
		
	};
	
	#handleWebSocketError = (error: Error | Event | undefined) => {
		if (error instanceof Event)
			error = undefined;
		
		if (this.#openReject) {
			this.#openReject(error);
			this.#openResolve = undefined;
			this.#openReject = undefined;
		}
		
		this.emit("error", error);
		
	};
	
	#reconnectTimeout?: number;
	
	#handleWebSocketClose = (event: CloseEvent) => {
		
		if (process.env.NODE_ENV === "development")
			console.info(`WebSocket ${this.name} is closed with code ${event.code} and reason "${event.reason}"`);
		
		this.#defib.clear();
		
		this.emit("close", event);
		
		if (this.autoReconnect && ![ 1002, 3500, 4000 ].includes(event.code)) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} will try to reconnect in 2 sec…`);
			
			this.#reconnectTimeout = setTimeout(() => this.open().catch(noop), reconnectTimeout) as unknown as number;
		}
		
	};
	
	async open(options: Options = {}) {
		
		clearTimeout(this.#reconnectTimeout);
		
		await this.close(4000, "reopen");
		
		if (options.url)
			this.url = options.url;
		
		if (options.protocols)
			this.protocols = options.protocols;
		
		if (this.webSocket && webSocketUrlWeakMap.get(this.webSocket) !== this.url)
			this.emit("server-change");
		
		return new Promise((resolve, reject) => {
			this.#openResolve = resolve;
			this.#openReject = reject;
			
			this.webSocket = new WebSocket(this.url, this.protocols);
			
			this.webSocket.addEventListener("open", this.#handleWebSocketOpen);
			this.webSocket.addEventListener("message", this.#handleWebSocketMessage);
			this.webSocket.addEventListener("error", this.#handleWebSocketError);
			this.webSocket.addEventListener("close", this.#handleWebSocketClose);
			
			this.send = this.webSocket.send.bind(this.webSocket);
			
			webSocketUrlWeakMap.set(this.webSocket, this.url);
			
			this.emit("connecting");
			
		});
	}
	
	connect = this.open;
	
	close(code = 3500, reason = "manual") {
		
		clearTimeout(this.#reconnectTimeout);
		
		return new Promise(resolve => {
			if (this.isConnecting || this.isOpen) {
				this.webSocket!.addEventListener("close", resolve);
				this.webSocket!.close(code, reason);
			} else
				resolve(null);
			
		});
	}
	
	disconnect = this.close;
	
	#queue: string[] = [];
	
	#releaseQueue = () => {
		
		for (const message of this.#queue)
			this.webSocket!.send(message);
		
		this.#queue.length = 0;
		
	};
	
	sendMessage(...args: unknown[]) {
		const message = JSON.stringify(args);
		
		if (this.isOpen)
			this.webSocket!.send(message);
		else {
			if (!this.#queue.length)
				this.once("open", this.#releaseQueue);
			
			this.#queue.push(message);
		}
		
	}
	
	
	static defib(this: InSiteWebSocket) {
		
		if (this.isOpen) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} has no heartbeat - going offline`);
			
			this.webSocket!.close();
		}
		
	}
	
}
