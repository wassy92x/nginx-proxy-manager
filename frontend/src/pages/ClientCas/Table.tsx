import { IconCertificate, IconDotsVertical, IconDownload, IconEdit, IconRefresh, IconTrash } from "@tabler/icons-react";
import { createColumnHelper, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import type { ClientCa } from "src/api/backend";
import { DateFormatter, EmptyData, GravatarFormatter, HasPermission, ValueWithDateFormatter } from "src/components";
import { type Features, features } from "src/components/Table/features";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";

interface Props {
	data: ClientCa[];
	isFiltered?: boolean;
	isFetching?: boolean;
	onEdit?: (id: number) => void;
	onCertificates?: (id: number) => void;
	onRenew?: (id: number) => void;
	onDownload?: (id: number) => void;
	onDelete?: (id: number) => void;
	onNew?: () => void;
}
export default function Table({
	data,
	isFetching,
	isFiltered,
	onEdit,
	onCertificates,
	onRenew,
	onDownload,
	onDelete,
	onNew,
}: Props) {
	const columnHelper = createColumnHelper<Features, ClientCa>();
	const columns = useMemo(
		() => [
			columnHelper.accessor((row: any) => row.owner, {
				id: "owner",
				cell: (info: any) => {
					const value = info.getValue();
					return <GravatarFormatter url={value ? value.avatar : ""} name={value ? value.name : ""} />;
				},
				meta: {
					className: "w-1",
				},
			}),
			columnHelper.accessor((row: any) => row, {
				id: "name",
				header: intl.formatMessage({ id: "column.name" }),
				cell: (info: any) => (
					<ValueWithDateFormatter value={info.getValue().name} createdOn={info.getValue().createdOn} />
				),
			}),
			columnHelper.accessor((row: any) => row.validityDays, {
				id: "validityDays",
				header: intl.formatMessage({ id: "column.validity" }),
				cell: (info: any) => <T id="days-count" data={{ count: info.getValue() }} />,
			}),
			columnHelper.accessor((row: any) => row.expiresOn, {
				id: "expiresOn",
				header: intl.formatMessage({ id: "column.expires" }),
				cell: (info: any) => <DateFormatter value={info.getValue()} highlightPast />,
			}),
			columnHelper.accessor((row: any) => row.clientCertificateCount, {
				id: "clientCertificateCount",
				header: intl.formatMessage({ id: "client-certificates" }),
				cell: (info: any) => <T id="client-ca.certificate-count" data={{ count: info.getValue() || 0 }} />,
			}),
			columnHelper.display({
				id: "id",
				cell: (info: any) => {
					return (
						<span className="dropdown">
							<button
								type="button"
								className="btn dropdown-toggle btn-action btn-sm px-1"
								data-bs-boundary="viewport"
								data-bs-toggle="dropdown"
							>
								<IconDotsVertical />
							</button>
							<div className="dropdown-menu dropdown-menu-end">
								<span className="dropdown-header">
									<T
										id="object.actions-title"
										tData={{ object: "client-ca" }}
										data={{ id: info.row.original.id }}
									/>
								</span>
								<a
									className="dropdown-item"
									href="#"
									onClick={(e) => {
										e.preventDefault();
										onCertificates?.(info.row.original.id);
									}}
								>
									<IconCertificate size={16} />
									<T id="client-certificates" />
								</a>
								<a
									className="dropdown-item"
									href="#"
									onClick={(e) => {
										e.preventDefault();
										onDownload?.(info.row.original.id);
									}}
								>
									<IconDownload size={16} />
									<T id="client-ca.download" />
								</a>
								<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
									<a
										className="dropdown-item"
										href="#"
										onClick={(e) => {
											e.preventDefault();
											onEdit?.(info.row.original.id);
										}}
									>
										<IconEdit size={16} />
										<T id="action.edit" />
									</a>
									<a
										className="dropdown-item"
										href="#"
										onClick={(e) => {
											e.preventDefault();
											onRenew?.(info.row.original.id);
										}}
									>
										<IconRefresh size={16} />
										<T id="action.renew" />
									</a>
									<div className="dropdown-divider" />
									<a
										className="dropdown-item"
										href="#"
										onClick={(e) => {
											e.preventDefault();
											onDelete?.(info.row.original.id);
										}}
									>
										<IconTrash size={16} />
										<T id="action.delete" />
									</a>
								</HasPermission>
							</div>
						</span>
					);
				},
				meta: {
					className: "text-end w-1",
				},
			}),
		],
		[columnHelper, onEdit, onCertificates, onRenew, onDownload, onDelete],
	);

	const tableInstance = useTable({
		features,
		columns,
		data,
		meta: {
			isFetching,
		},
		enableSortingRemoval: false,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					object="client-ca"
					objects="client-cas"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					color="teal"
					permissionSection={ACCESS_LISTS}
				/>
			}
		/>
	);
}
