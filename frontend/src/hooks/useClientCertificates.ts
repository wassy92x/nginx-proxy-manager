import { useQuery } from "@tanstack/react-query";
import { type ClientCertificate, getClientCertificates } from "src/api/backend";

const useClientCertificates = (caId: number, options = {}) => {
	return useQuery<ClientCertificate[], Error>({
		queryKey: ["client-certificates", caId],
		queryFn: () => getClientCertificates(caId),
		staleTime: 60 * 1000,
		...options,
	});
};

export { useClientCertificates };
