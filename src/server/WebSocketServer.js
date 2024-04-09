import http from "node:http";
import https from "node:https";
import { debounce } from "@nesvet/n";
import { WebSocketServer } from "ws";
import { heartbeatGap, heartbeatInterval } from "../common";
import { extendEventEmitter } from "../extendEventEmitter";
import { defibSymbol, heartbeatIntervalSymbol, pingTsSymbol } from "./symbols";
import { WebSocketServerClient } from "./WebSocketServerClient";


class InSiteWebSocketServer extends WebSocketServer {
	constructor(options = {}, props, handleListen) {
		const {
			upgrade,
			ssl,
			port,
			server = ssl ? https.createServer({ ...ssl }) : http.createServer(),
			...wssOptions
		} = options;
		
		super({
			...wssOptions,
			WebSocket: WebSocketServerClient,
			server
		});
		
		extendEventEmitter(this);
		
		if ("upgrade" in this)
			throw new Error("WebSocketServer now contains an \"upgrade\" property");
		
		if (props)
			if (typeof props == "function") {
				handleListen = props;
				props = undefined;
			} else
				Object.assign(this, props);
		
		this.upgrade = upgrade;
		
		this.on("connection", this.#handleConnection);
		
		server.listen(port, handleListen);
		
	}
	
	isWebSocketServer = true;
	
	#handleConnection(ws, request) {
		ws.wss = this;
		
		ws.userAgent = request.headers["user-agent"];
		ws.remoteAddress = request.headers["x-real-ip"] ?? request.headers["x-forwarded-for"] ?? "127.0.0.1";
		
		ws.on("message", InSiteWebSocketServer.handleClientMessage);
		ws.on("error", InSiteWebSocketServer.handleClientError);
		ws.on("close", InSiteWebSocketServer.handleClientClose);
		
		ws[defibSymbol] = debounce(() => ws.terminate(), heartbeatInterval + heartbeatGap);
		ws[defibSymbol]();
		
		ws.latency = 0;
		
		ws[heartbeatIntervalSymbol] = setInterval(() => {
			
			ws[pingTsSymbol] = Date.now();
			ws.send("");
			
		}, heartbeatInterval);
		
		this.emit("client-connect", ws, request);
		
	}
	
	static handleClientMessage(data) {
		const message = data.toString();
		
		this[defibSymbol]();
		
		if (message)
			try {
				const [ kind, ...rest ] = JSON.parse(message);
				
				this.emit(`message:${kind}`, ...rest);
				this.wss.emit("client-message", this, kind, ...rest);
				this.wss.emit(`client-message:${kind}`, this, ...rest);
			} catch (error) {
				InSiteWebSocketServer.handleClientError.call(this, error);
			}
		 else if (this[pingTsSymbol]) {
			this.latency = Date.now() - this[pingTsSymbol];
			delete this[pingTsSymbol];
		}
		
	}
	
	static handleClientError(error) {
		if (error instanceof Event)
			error = undefined;
		
		if (process.env.NODE_ENV === "development")
			console.error("WebSocketServer Client error", error);
		
		this.wss.emit("client-error", this, error);
		
	}
	
	static handleClientClose(...args) {
		
		if (process.env.NODE_ENV === "development")
			console.info("WebSocketServer Client closed", ...args);
		
		this[defibSymbol].clear();
		clearInterval(this[heartbeatIntervalSymbol]);
		
		this.wss.emit("client-close", this);
		this.wss.emit("client-closed", this);
		
	}
	
}

export { InSiteWebSocketServer as WebSocketServer };
