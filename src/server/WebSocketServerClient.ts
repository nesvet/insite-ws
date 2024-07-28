import { WebSocket } from "ws";
import { debounce, uid } from "@nesvet/n";
import { heartbeatGap, heartbeatInterval, requestHeaders } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { InSiteWebSocketServer } from "./WebSocketServer";


export class InSiteWebSocketServerClient extends WebSocket {
	
	get isConnecting() {
		return this.readyState === this.CONNECTING;
	}
	
	get isOpen() {
		return this.readyState === this.OPEN;
	}
	
	get isClosing() {
		return this.readyState === this.CLOSING;
	}
	
	get isClosed() {
		return this.readyState === this.CLOSED;
	}
	
	readonly isWebSocketServerClient = true;
	readonly isWebSocketServer = false;
	readonly isWebSocket = false;
	
	wss!: InSiteWebSocketServer;
	
	userAgent = "";
	
	remoteAddress = "";
	
	[defibSymbol] = InSiteWebSocketServerClient.makeDefib.call(this);
	
	latency = 0;
	
	[pingTsSymbol]?: number;
	
	[heartbeatIntervalSymbol] = InSiteWebSocketServerClient.makeHeartbeatInterval.call(this);
	
	sendMessage(...args: unknown[]) {
		return this.send(JSON.stringify(args));
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
	
	
	static makeDefib(this: InSiteWebSocketServerClient) {
		return debounce(() => this.terminate(), heartbeatInterval + heartbeatGap);
	}
	
	static makeHeartbeatInterval(this: InSiteWebSocketServerClient) {
		return setInterval(() => {
			
			this[pingTsSymbol] = Date.now();
			this.send("");
			
		}, heartbeatInterval);
	}
	
}
