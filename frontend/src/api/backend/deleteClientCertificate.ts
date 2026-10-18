import * as api from "./base";

export async function deleteClientCertificate(caId: number, id: number): Promise<boolean> {
	return await api.del({
		url: `/nginx/client-cas/${caId}/certificates/${id}`,
	});
}
