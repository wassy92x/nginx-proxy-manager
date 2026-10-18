import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ClientCa, type ClientCaExpansion, createClientCa, getClientCa, updateClientCa } from "src/api/backend";

const fetchClientCa = (id: number | "new", expand: ClientCaExpansion[] = ["owner"]) => {
	if (id === "new") {
		return Promise.resolve({
			id: 0,
			name: "",
			validityDays: 3650,
			meta: {},
		} as ClientCa);
	}
	return getClientCa(id, expand);
};

const useClientCa = (id: number | "new", expand?: ClientCaExpansion[], options = {}) => {
	return useQuery<ClientCa, Error>({
		queryKey: ["client-ca", id, expand],
		queryFn: () => fetchClientCa(id, expand),
		staleTime: 60 * 1000, // 1 minute
		...options,
	});
};

const useSetClientCa = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values: ClientCa) => (values.id ? updateClientCa(values) : createClientCa(values)),
		onSuccess: async ({ id }: ClientCa) => {
			queryClient.invalidateQueries({ queryKey: ["client-ca", id] });
			queryClient.invalidateQueries({ queryKey: ["client-cas"] });
			queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
		},
	});
};

export { useClientCa, useSetClientCa };
