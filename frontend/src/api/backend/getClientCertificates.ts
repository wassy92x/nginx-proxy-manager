import * as api from "./base";
import type { ClientCertificate } from "./models";

export async function getClientCertificates(caId: number): Promise<ClientCertificate[]> {
	return await api.get({
		url: `/nginx/client-cas/${caId}/certificates`,
	});
}
