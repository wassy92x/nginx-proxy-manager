import { IconSearch } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import { deleteClientCa, downloadClientCa, renewClientCa } from "src/api/backend";
import { Button, HasPermission, LoadingPage } from "src/components";
import { useClientCas } from "src/hooks";
import { T } from "src/locale";
import { showClientCaModal, showClientCertificatesModal, showDeleteConfirmModal } from "src/modals";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { showError, showObjectSuccess } from "src/notifications";
import Table from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const { isFetching, isLoading, isError, error, data } = useClientCas(["owner"]);

	if (isLoading) {
		return <LoadingPage />;
	}

	if (isError) {
		return <Alert variant="danger">{error?.message || "Unknown error"}</Alert>;
	}

	const handleDelete = async (id: number) => {
		await deleteClientCa(id);
		showObjectSuccess("client-ca", "deleted");
	};

	const handleRenew = async (id: number) => {
		try {
			await renewClientCa(id);
			showObjectSuccess("client-ca", "renewed");
			queryClient.invalidateQueries({ queryKey: ["client-cas"] });
		} catch (err: any) {
			showError(err.message);
		}
	};

	const handleDownload = async (id: number) => {
		try {
			await downloadClientCa(id);
		} catch (err: any) {
			showError(err.message);
		}
	};

	let filtered = null;
	if (search && data) {
		filtered = data?.filter((item) => {
			return item.name.toLowerCase().includes(search);
		});
	} else if (search !== "") {
		// this can happen if someone deletes the last item while searching
		setSearch("");
	}

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-teal" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="client-cas" />
							</h2>
						</div>

						<div className="col-md-auto col-sm-12">
							<div className="ms-auto d-flex flex-wrap btn-list">
								{data?.length ? (
									<div className="input-group input-group-flat w-auto">
										<span className="input-group-text input-group-text-sm">
											<IconSearch size={16} />
										</span>
										<input
											id="advanced-table-search"
											type="text"
											className="form-control form-control-sm"
											autoComplete="off"
											onChange={(e: any) => setSearch(e.target.value.toLowerCase().trim())}
										/>
									</div>
								) : null}
								<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
									{data?.length ? (
										<Button size="sm" className="btn-teal" onClick={() => showClientCaModal("new")}>
											<T id="object.add" tData={{ object: "client-ca" }} />
										</Button>
									) : null}
								</HasPermission>
							</div>
						</div>
					</div>
				</div>
				<Table
					data={filtered ?? data ?? []}
					isFetching={isFetching}
					isFiltered={!!filtered}
					onEdit={(id: number) => showClientCaModal(id)}
					onCertificates={(id: number) => showClientCertificatesModal(id)}
					onRenew={handleRenew}
					onDownload={handleDownload}
					onDelete={(id: number) =>
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "client-ca" }} />,
							onConfirm: () => handleDelete(id),
							invalidations: [["client-cas"], ["client-ca", id]],
							children: <T id="client-ca.delete.content" />,
						})
					}
					onNew={() => showClientCaModal("new")}
				/>
			</div>
		</div>
	);
}
