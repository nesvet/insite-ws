export const heartbeatInterval = 5_000;
export const heartbeatGap = 60_000;

export const requestHeaders = {
	request: "~r-q",
	response: "~r-s"
};

export type RequestListener = (...args: unknown[]) => Promise<unknown> | unknown;
