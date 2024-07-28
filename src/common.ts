export const heartbeatInterval = 5_000;
export const heartbeatGap = 60_000;

export const requestHeaders = {
	request: "~r-q",
	response: "~r-s"
};

export type RequestListener = (...args: any[]) => any | Promise<any>;// eslint-disable-line @typescript-eslint/no-explicit-any
