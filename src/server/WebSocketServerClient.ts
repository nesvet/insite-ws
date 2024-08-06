import { ClientRequest, IncomingMessage } from "node:http";
import { RawData, WebSocket } from "ws";
import { debounce, uid } from "@nesvet/n";
import { heartbeatGap, heartbeatInterval, requestHeaders } from "../common";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { InSiteWebSocketServer } from "./WebSocketServer";


declare abstract class PrepareWebSocket<WSSC extends InSiteWebSocketServerClient = InSiteWebSocketServerClient> extends WebSocket {
	on(event: "close", listener: (this: WSSC, code: number, reason: Buffer) => void): this;
	on(event: "error", listener: (this: WSSC, error: Error) => void): this;
	on(event: "upgrade", listener: (this: WSSC, request: IncomingMessage) => void): this;
	on(event: "message", listener: (this: WSSC, data: RawData, isBinary: boolean) => void): this;
	on(event: "open", listener: (this: WSSC) => void): this;
	on(event: "ping" | "pong", listener: (this: WSSC, data: Buffer) => void): this;
	on(
		event: "unexpected-response",
		listener: (this: WSSC, request: ClientRequest, response: IncomingMessage) => void,
	): this;
	on(event: string | symbol, listener: (this: WSSC, ...args: unknown[]) => void): this;
}


export class InSiteWebSocketServerClient<WSSC extends InSiteWebSocketServerClient = any> extends PrepareWebSocket<WSSC> {// eslint-disable-line @typescript-eslint/no-explicit-any
	
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
	
	wss!: InSiteWebSocketServer<WSSC>;
	
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
	
	
	static makeDefib(this: InSiteWebSocketServerClient<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
		return debounce(() => this.terminate(), heartbeatInterval + heartbeatGap);
	}
	
	static makeHeartbeatInterval(this: InSiteWebSocketServerClient<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
		return setInterval(() => {
			
			this[pingTsSymbol] = Date.now();
			this.send("");
			
		}, heartbeatInterval);
	}
	
}
