export type Options = {
	url?: string;
	name?: string;
	protocols?: string[];
	immediately?: boolean;
	autoReconnect?: boolean;
	on?: Record<string, (...args: unknown[]) => void>;
};
