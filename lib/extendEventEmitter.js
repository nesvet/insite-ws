/** @this EventEmitter */
function extendedOn(...args) {
	
	for (const listenerHandler of this.listenerHandlers)
		if (listenerHandler.call(this, true, ...args) !== undefined)
			return;
	
	this.directOn(...args);
	
}

/** @this EventEmitter */
function extendedOnce(...args) {
	
	for (const listenerHandler of this.listenerHandlers)
		if (listenerHandler.call(this, true, ...args) !== undefined)
			return;
	
	this.directOnce(...args);
	
}

/** @this EventEmitter */
function extendedOff(...args) {
	
	for (const listenerHandler of this.listenerHandlers)
		if (listenerHandler.call(this, false, ...args) !== undefined)
			return;
	
	this.directOff(...args);
	
}

export function extendEventEmitter(eventEmitter) {
	
	eventEmitter.directOn = eventEmitter.on;
	eventEmitter.directOnce = eventEmitter.once;
	eventEmitter.directOff = eventEmitter.off;
	
	eventEmitter.listenerHandlers = new Set();
	
	eventEmitter.on = extendedOn;
	eventEmitter.once = extendedOnce;
	eventEmitter.off = extendedOff;
	
}
