import WebSocket from "ws";


class InSiteWebSocketServerClient extends WebSocket {
	
	isWebSocketServerClient = true;
	
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
	
	sendMessage(...args) {
		this.send(JSON.stringify(args));
		
	}
	
}

export { InSiteWebSocketServerClient as WebSocketServerClient };
