import * as api from "./base";

export async function downloadClientCa(id: number): Promise<void> {
	await api.download(
		{
			url: `/nginx/client-cas/${id}/download`,
		},
		`client-ca-${id}.pem`,
	);
}
