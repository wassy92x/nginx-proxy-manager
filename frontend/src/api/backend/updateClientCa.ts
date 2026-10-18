import * as api from "./base";
import type { ClientCa } from "./models";

export async function updateClientCa(item: ClientCa): Promise<ClientCa> {
	return await api.put({
		url: `/nginx/client-cas/${item.id}`,
		data: {
			name: item.name,
			validityDays: item.validityDays,
		},
	});
}
