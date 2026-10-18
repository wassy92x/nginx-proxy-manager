import * as api from "./base";

export async function deleteClientCa(id: number): Promise<boolean> {
	return await api.del({
		url: `/nginx/client-cas/${id}`,
	});
}
