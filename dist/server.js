import y from"node:http";import x from"node:https";import{debounce as v}from"@nesvet/n";import{WebSocketServer as N}from"ws";function b(...t){for(let e of this.listenerHandlers)if(e.call(this,!0,...t)!==void 0)return;this.directOn(...t)}function u(...t){for(let e of this.listenerHandlers)if(e.call(this,!0,...t)!==void 0)return;this.directOnce(...t)}function g(...t){for(let e of this.listenerHandlers)if(e.call(this,!1,...t)!==void 0)return;this.directOff(...t)}function h(t){t.directOn=t.on,t.directOnce=t.once,t.directOff=t.off,t.listenerHandlers=new Set,t.on=b,t.once=u,t.off=g}var l=Symbol("heartbeatInterval"),i=Symbol("defib"),o=Symbol("pingTs");import C from"ws";var a=class extends C{isWebSocketServerClient=!0;get isConnecting(){return this.readyState===this.CONNECTING}get isOpen(){return this.readyState===this.OPEN}get isClosing(){return this.readyState===this.CLOSING}get isClosed(){return this.readyState===this.CLOSED}sendMessage(...e){this.send(JSON.stringify(e))}};var m=class t extends N{constructor(e={},r,n){let{upgrade:s,ssl:c,port:S,server:d=c?x.createServer({...c}):y.createServer(),...p}=e;if(super({...p,WebSocket:a,server:d}),h(this),"upgrade"in this)throw new Error('WebSocketServer now contains an "upgrade" property');r&&(typeof r=="function"?(n=r,r=void 0):Object.assign(this,r)),this.upgrade=s,this.on("connection",this.#e),d.listen(S,n)}isWebSocketServer=!0;#e(e,r){e.wss=this,e.userAgent=r.headers["user-agent"],e.remoteAddress=r.headers["x-real-ip"]??r.headers["x-forwarded-for"]??"127.0.0.1",e.on("message",t.handleClientMessage),e.on("error",t.handleClientError),e.on("close",t.handleClientClose),e[i]=v(()=>e.terminate(),65e3),e[i](),e.latency=0,e[l]=setInterval(()=>{e[o]=Date.now(),e.send("")},5e3),this.emit("client-connect",e,r)}static handleClientMessage(e){let r=e.toString();if(this[i](),r)try{let[n,...s]=JSON.parse(r);this.emit(`message:${n}`,...s),this.wss.emit("client-message",this,n,...s),this.wss.emit(`client-message:${n}`,this,...s)}catch(n){t.handleClientError.call(this,n)}else this[o]&&(this.latency=Date.now()-this[o],delete this[o])}static handleClientError(e){e instanceof Event&&(e=void 0),this.wss.emit("client-error",this,e)}static handleClientClose(...e){this[i].clear(),clearInterval(this[l]),this.wss.emit("client-close",this),this.wss.emit("client-closed",this)}};export{m as WebSocketServer};
//# sourceMappingURL=server.js.map