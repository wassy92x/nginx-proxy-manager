import * as api from "./base";
import type { ClientCertificate } from "./models";

export async function revokeClientCertificate(caId: number, id: number): Promise<ClientCertificate> {
	return await api.post({
		url: `/nginx/client-cas/${caId}/certificates/${id}/revoke`,
	});
}
