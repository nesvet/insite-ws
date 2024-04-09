import { debounce, noop } from "@nesvet/n";
import EventEmitter from "eventemitter3";
import { heartbeatGap, heartbeatInterval } from "../common";
import { extendEventEmitter } from "../extendEventEmitter";


const reconnectTimeout = 2000;

let i = 0;


class InSiteWebSocket extends EventEmitter {
	constructor(url, options = {}) {
		super();
		
		extendEventEmitter(this);
		
		this.url = url;
		
		const {
			name = i++,
			protocols,
			immediately = true,
			autoReconnect = true,
			on
		} = options;
		
		this.name = name;
		
		this.protocols = protocols;
		
		this.autoReconnect = autoReconnect;
		
		if (on)
			for (const eventName in on)
				if (on[eventName])
					this.on(eventName, on[eventName]);
		
		if (this.url && immediately)
			this.open().catch(noop);
		
	}
	
	webSocket = null;
	
	#defib = debounce(function () {
		
		if (this.isOpen) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} has no heartbeat - going offline`);
			
			this.webSocket.close();
		}
		
	}, heartbeatInterval + heartbeatGap);
	
	#openResolve;
	#openReject;
	
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
	
	isChanged = false;
	
	#handleWebSocketOpen = () => {
		
		this.#openResolve();
		this.#openResolve = undefined;
		this.#openReject = undefined;
		
		this.emit("open");
		
		this.#defib();
		
	};
	
	#handleWebSocketMessage = ({ data: message }) => {
		
		this.#defib();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit("message", kind, ...rest);
				this.emit(`message:${kind}`, ...rest);
			} catch (error) {
				this.#handleWebSocketError(error);
			}
		 else
			this.webSocket.send("");
		
	};
	
	#handleWebSocketError = error => {
		if (error instanceof Event)
			error = undefined;
		
		if (this.#openReject) {
			this.#openReject(error);
			this.#openResolve = undefined;
			this.#openReject = undefined;
		}
		
		this.emit("error", error);
		
	};
	
	#reconnectTimeout;
	
	#handleWebSocketClose = event => {
		
		if (process.env.NODE_ENV === "development")
			console.info(`WebSocket ${this.name} is closed with code ${event.code} and reason "${event.reason}"`);
		
		this.#defib.clear();
		
		this.emit("close", event);
		
		if (this.autoReconnect && ![ 1002, 3500, 4000 ].includes(event.code)) {
			if (process.env.NODE_ENV === "development")
				console.info(`WebSocket ${this.name} will try to reconnect in 2 sec…`);
			
			this.#reconnectTimeout = setTimeout(() => this.open().catch(noop), reconnectTimeout);
		}
		
	};
	
	open(options = {}) {
		
		clearTimeout(this.#reconnectTimeout);
		
		return this.close(4000, "reopen").then(() => {
			
			if (options.url)
				this.url = options.url;
			
			if (options.protocols)
				this.protocols = options.protocols;
			
			return new Promise((resolve, reject) => {
				this.#openResolve = resolve;
				this.#openReject = reject;
				
				if (this.webSocket) {
					this.isChanged = this.webSocket._url !== this.url;
					if (this.isChanged)
						this.emit("server-change");
				}
				
				this.webSocket = new WebSocket(this.url, this.protocols);
				this.webSocket._url = this.url;
				
				this.emit("connecting");
				
				this.send = this.webSocket.send.bind(this.webSocket);
				
				this.webSocket.addEventListener("open", this.#handleWebSocketOpen);
				this.webSocket.addEventListener("message", this.#handleWebSocketMessage);
				this.webSocket.addEventListener("error", this.#handleWebSocketError);
				this.webSocket.addEventListener("close", this.#handleWebSocketClose);
				
			});
		});
	}
	
	connect = this.open;
	
	close(code = 3500, reason = "manual") {
		
		clearTimeout(this.#reconnectTimeout);
		
		return new Promise(resolve => {
			if (this.isConnecting || this.isOpen) {
				this.webSocket.addEventListener("close", resolve);
				this.webSocket.close(code, reason);
			} else
				resolve();
			
		});
	}
	
	disconnect = this.close;
	
	#queue = [];
	
	#releaseQueue = () => {
		
		for (const message of this.#queue)
			this.webSocket.send(message);
		
		this.#queue.length = 0;
		
	};
	
	sendMessage(...args) {
		const message = JSON.stringify(args);
		
		if (this.isOpen)
			this.webSocket.send(message);
		else {
			if (!this.#queue.length)
				this.once("open", this.#releaseQueue);
			
			this.#queue.push(message);
		}
		
	}
	
}

export { InSiteWebSocket as WebSocket };
