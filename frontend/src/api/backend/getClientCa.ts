import * as api from "./base";
import type { ClientCaExpansion } from "./expansions";
import type { ClientCa } from "./models";

export async function getClientCa(id: number, expand?: ClientCaExpansion[], params = {}): Promise<ClientCa> {
	return await api.get({
		url: `/nginx/client-cas/${id}`,
		params: {
			expand: expand?.join(","),
			...params,
		},
	});
}
