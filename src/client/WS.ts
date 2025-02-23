import EventEmitter from "eventemitter3";
import {
	debounce,
	noop,
	StatefulPromise,
	uid
} from "@nesvet/n";
import { heartbeatGap, heartbeatInterval, requestHeaders } from "../common";


declare global {
	var __insite: { // eslint-disable-line no-var
		wss_url?: string;
	} | undefined;
}

let i = 0;

export type Options = {
	url?: URL | string;
	name?: string;
	protocols?: string[];
	immediately?: boolean;
	reconnectAfter?: number | null;
	on?: Record<string, (...args: any[]) => void>;// eslint-disable-line @typescript-eslint/no-explicit-any
	quiet?: boolean;
};

type RequestListener = (...args: any[]) => Promise<any> | any;// eslint-disable-line @typescript-eslint/no-explicit-any


export class WS extends EventEmitter {
	constructor(options: Options = {}) {
		super();
		
		const {
			url = globalThis.__insite?.wss_url ?? "/",
			name = (i++).toString(),
			protocols,
			immediately = true,
			reconnectAfter = 2000,
			on,
			quiet = false
		} = options;
		
		this.url = url;
		this.name = name;
		
		this.protocols = protocols;
		
		this.reconnectAfter = reconnectAfter;
		
		this.on(`message:${requestHeaders.request}`, this.#handleRequest);
		
		if (on)
			for (const eventName in on)
				if (on[eventName])
					this.on(eventName, on[eventName]);
		
		this.#isQuiet = quiet;
		
		if (this.url && immediately)
			this.open().catch(noop);
		
		this.on("error", (error: Error) => error && console.error("🔌❗️ WS", `${this.name}:`, error));
		
	}
	
	readonly isWebSocket = true;
	readonly isWebSocketServer = false;
	readonly isWebSocketServerClient = false;
	
	url;
	
	readonly name;
	
	protocols?;
	
	reconnectAfter;
	
	#isQuiet;
	
	isUsed = false;
	isAutoReconnecting = false;
	
	send?(data: ArrayBufferLike | ArrayBufferView | Blob | string): void;
	
	webSocket: WebSocket | null = null;
	
	#defib = debounce(WS.defib, heartbeatInterval + heartbeatGap);
	
	get isConnecting() {
		return this.webSocket ? this.webSocket.readyState === WebSocket.CONNECTING : null;
	}
	
	get isOpen() {
		return this.webSocket ? this.webSocket.readyState === WebSocket.OPEN : null;
	}
	
	get isClosing() {
		return this.webSocket ? this.webSocket.readyState === WebSocket.CLOSING : null;
	}
	
	get isClosed() {
		return !this.webSocket || this.webSocket.readyState === WebSocket.CLOSED;
	}
	
	#openPromise?: StatefulPromise<void>;
	
	#handleWebSocketOpen = () => {
		
		this.#openPromise!.resolve();
		
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
		
		if (this.#openPromise!.isPending)
			this.#openPromise!.reject(error);
		
		this.emit("error", error);
		
	};
	
	#reconnectTimeout?: number;
	
	#handleWebSocketClose = (event: CloseEvent) => {
		
		if (process.env.NODE_ENV === "development" && !this.#isQuiet)
			console.info(`🔌 WS ${this.name} is closed ${event.code ? `with code ${event.code}` : ""} ${event.code && event.reason ? "and " : ""}${event.reason ? `reason "${event.reason}"` : ""}`);
		
		this.#defib.clear();
		
		const webSocket = this.webSocket!;
		
		webSocket.removeEventListener("open", this.#handleWebSocketOpen);
		webSocket.removeEventListener("message", this.#handleWebSocketMessage);
		webSocket.removeEventListener("error", this.#handleWebSocketError);
		webSocket.removeEventListener("close", this.#handleWebSocketClose);
		
		delete this.send;
		
		this.emit("close", event);
		
		this.webSocket = null;
		
		if (this.reconnectAfter && ![ 1002, 3500, 4000 ].includes(event.code)) {
			if (process.env.NODE_ENV === "development" && !this.#isQuiet)
				console.info(`🔌 WS ${this.name} will try to reconnect in 2 seconds`);
			
			this.#reconnectTimeout = setTimeout(() => this.open().catch(noop), this.reconnectAfter) as unknown as number;
		}
		
	};
	
	
	async open(options: Pick<Options, "protocols" | "url"> = {}): Promise<void> {
		
		clearTimeout(this.#reconnectTimeout);
		
		this.isUsed = true;
		this.isAutoReconnecting = !!this.reconnectAfter;
		
		await this.close(4000, "reopen");
		
		let prevURL: URL | string | undefined;
		if (options.url && this.url !== options.url) {
			prevURL = this.url;
			this.url = options.url;
		}
		
		if (options.protocols)
			this.protocols = options.protocols;
		
		this.#openPromise = new StatefulPromise((resolve, reject) => {
			
			if (this.url) {
				const webSocket = new WebSocket(this.url, this.protocols);
				
				webSocket.addEventListener("open", this.#handleWebSocketOpen);
				webSocket.addEventListener("message", this.#handleWebSocketMessage);
				webSocket.addEventListener("error", this.#handleWebSocketError);
				webSocket.addEventListener("close", this.#handleWebSocketClose, { once: true });
				
				this.send = webSocket.send.bind(webSocket);
				
				this.webSocket = webSocket;
				
				if (prevURL)
					this.emit("server-change", this.url, prevURL);
				
				this.emit("connecting");
			} else {
				this.webSocket = null;
				delete this.send;
				reject(new Error("url prop is not set"));
			}
			
		});
		
		return this.#openPromise;
	}
	
	connect = this.open;
	
	close(code = 3500, reason = "manual") {
		
		clearTimeout(this.#reconnectTimeout);
		
		if (reason === "manual")
			this.isAutoReconnecting = false;
		
		return new Promise<void>(resolve => {
			
			if (this.isConnecting || this.isOpen) {
				this.webSocket!.addEventListener("close", () => resolve(), { once: true });
				this.webSocket!.close(code, reason);
			} else
				resolve();
			
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
	
	#handleRequest = async (id: string, kind: string, ...rest: unknown[]) => {
		const listener = this.#requestListeners.get(kind);
		
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
	
	
	static defib(this: WS) {
		
		if (this.isOpen) {
			if (process.env.NODE_ENV === "development" && !this.#isQuiet)
				console.info(`🔌 WS ${this.name} has no heartbeat, going offline`);
			
			this.webSocket!.close();
		}
		
	}
	
}
