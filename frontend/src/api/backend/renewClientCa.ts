import * as api from "./base";
import type { ClientCa } from "./models";

export async function renewClientCa(id: number): Promise<ClientCa> {
	return await api.post({
		url: `/nginx/client-cas/${id}/renew`,
	});
}
