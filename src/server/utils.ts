import type { IncomingMessage } from "node:http";


const headersThatMayContainRemoteAddress = [
	"forwarded",
	"x-forwarded",
	"forwarded-for",
	"x-forwarded-for",
	"x-real-ip",
	"cf-connecting-ip",
	"do-connecting-ip",
	"x-appengine-user-ip",
	"true-client-ip",
	"fastly-client-ip",
	"client-ip",
	"x-client-ip",
	"x-proxyuser-ip",
	"x-cluster-client-ip"
] as const;

let headerWithRemoteAddress: null | true | typeof headersThatMayContainRemoteAddress[number] | undefined;

const remoteAddressRegExp = /^.*?((?:\d{1,3}\.){3}\d{1,3}).*$/;

export function getRemoteAddress(request: IncomingMessage) {
	
	if (headerWithRemoteAddress === undefined) {
		for (const headerName of headersThatMayContainRemoteAddress) {
			const header = request.headers[headerName];
			if (typeof header == "string" && remoteAddressRegExp.test(header))
				headerWithRemoteAddress = headerName;
		}
		headerWithRemoteAddress ??=
			request.socket.remoteAddress && remoteAddressRegExp.test(request.socket.remoteAddress) ?
				true :
				null;
	}
	
	switch (headerWithRemoteAddress) {
		case true:
			return request.socket.remoteAddress;
		
		case null:
			return "127.0.0.1";
		
		default:
			return (request.headers[headerWithRemoteAddress] as string).replace(remoteAddressRegExp, "$1");
	}
}
