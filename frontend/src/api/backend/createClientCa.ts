import * as api from "./base";
import type { ClientCa } from "./models";

export async function createClientCa(item: ClientCa): Promise<ClientCa> {
	return await api.post({
		url: "/nginx/client-cas",
		data: {
			name: item.name,
			validityDays: item.validityDays,
		},
	});
}
