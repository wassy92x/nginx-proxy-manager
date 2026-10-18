import { useQuery } from "@tanstack/react-query";
import { type ClientCa, type ClientCaExpansion, getClientCas } from "src/api/backend";

const fetchClientCas = (expand?: ClientCaExpansion[]) => {
	return getClientCas(expand);
};

const useClientCas = (expand?: ClientCaExpansion[], options = {}) => {
	return useQuery<ClientCa[], Error>({
		queryKey: ["client-cas", { expand }],
		queryFn: () => fetchClientCas(expand),
		staleTime: 60 * 1000,
		...options,
	});
};

export { fetchClientCas, useClientCas };
