import { IconBan, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { isPast } from "date-fns";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik } from "formik";
import { generate } from "generate-password-browser";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	type ClientCertificate,
	deleteClientCertificate,
	type IssueClientCertificate,
	issueClientCertificate,
	revokeClientCertificate,
} from "src/api/backend";
import { Button, DateFormatter, HasPermission, Loading } from "src/components";
import { useClientCa, useClientCertificates } from "src/hooks";
import { intl, parseDate, T } from "src/locale";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { validateNumber, validateString } from "src/modules/Validations";
import { showError, showObjectSuccess, showSuccess } from "src/notifications";

const showClientCertificatesModal = (caId: number) => {
	EasyModal.show(ClientCertificatesModal, { caId });
};

const StatusBadge = ({ cert }: { cert: ClientCertificate }) => {
	if (cert.revoked) {
		return (
			<span className="badge bg-red-lt">
				<T id="client-certificate.revoked" />
			</span>
		);
	}
	const expires = parseDate(cert.expiresOn);
	if (expires && isPast(expires)) {
		return (
			<span className="badge bg-orange-lt">
				<T id="client-certificate.expired" />
			</span>
		);
	}
	return (
		<span className="badge bg-green-lt">
			<T id="client-certificate.valid" />
		</span>
	);
};

interface Props extends InnerModalProps {
	caId: number;
}
const ClientCertificatesModal = EasyModal.create(({ caId, visible, remove }: Props) => {
	const queryClient = useQueryClient();
	const { data: ca } = useClientCa(caId);
	const { data, isLoading, error } = useClientCertificates(caId);
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [busyId, setBusyId] = useState<number | null>(null);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["client-certificates", caId] });
		queryClient.invalidateQueries({ queryKey: ["client-cas"] });
		queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
	};

	const onIssue = async (values: any, { setSubmitting, setFieldValue, setFieldTouched }: any) => {
		setErrorMsg(null);
		const payload: IssueClientCertificate = {
			name: values.name,
			validityDays: Number.parseInt(values.validityDays, 10),
			format: values.format,
		};
		if (values.password) {
			payload.password = values.password;
		}
		try {
			await issueClientCertificate(caId, payload);
			showSuccess(intl.formatMessage({ id: "client-certificate.issued" }));
			// Keep the password, the file can't be opened without it and can't be downloaded again
			setFieldValue("name", "");
			setFieldTouched("name", false);
			invalidate();
		} catch (err: any) {
			setErrorMsg(<T id={err.message} />);
		}
		setSubmitting(false);
	};

	const onRevoke = async (id: number) => {
		if (!window.confirm(intl.formatMessage({ id: "client-certificate.revoke.confirm" }))) {
			return;
		}
		setBusyId(id);
		try {
			await revokeClientCertificate(caId, id);
			showSuccess(intl.formatMessage({ id: "client-certificate.revoke.success" }));
			invalidate();
		} catch (err: any) {
			showError(err.message);
		}
		setBusyId(null);
	};

	const onDelete = async (id: number) => {
		if (!window.confirm(intl.formatMessage({ id: "client-certificate.delete.confirm" }))) {
			return;
		}
		setBusyId(id);
		try {
			await deleteClientCertificate(caId, id);
			showObjectSuccess("client-certificate", "deleted");
			invalidate();
		} catch (err: any) {
			showError(err.message);
		}
		setBusyId(null);
	};

	return (
		<Modal show={visible} onHide={remove} size="lg">
			<Modal.Header closeButton>
				<Modal.Title>
					<T id="client-certificates" />
					{ca?.name ? <> &ndash; {ca.name}</> : null}
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{isLoading && <Loading noLogo />}
				{!isLoading && error && <Alert variant="danger">{error?.message || "Unknown error"}</Alert>}
				{!isLoading && data && !data.length ? (
					<p className="text-center text-secondary my-3">
						<T id="object.empty" tData={{ objects: "client-certificates" }} />
					</p>
				) : null}
				{!isLoading && data?.length ? (
					<div className="table-responsive mb-3">
						<table className="table table-vcenter card-table">
							<thead>
								<tr>
									<th>
										<T id="column.name" />
									</th>
									<th>
										<T id="column.serial" />
									</th>
									<th>
										<T id="column.expires" />
									</th>
									<th>
										<T id="column.status" />
									</th>
									<th className="w-1" />
								</tr>
							</thead>
							<tbody>
								{data.map((cert: ClientCertificate) => (
									<tr key={cert.id}>
										<td>{cert.name}</td>
										<td>
											<code className="text-xs" title={cert.serial}>
												{cert.serial.substring(0, 12)}&hellip;
											</code>
										</td>
										<td>
											<DateFormatter value={cert.expiresOn} highlightPast highlistNearlyExpired />
										</td>
										<td>
											<StatusBadge cert={cert} />
										</td>
										<td className="text-nowrap">
											<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
												{!cert.revoked ? (
													<button
														type="button"
														className="btn btn-sm btn-ghost-warning me-1"
														title={intl.formatMessage({ id: "client-certificate.revoke" })}
														disabled={busyId === cert.id}
														onClick={() => onRevoke(cert.id)}
													>
														<IconBan size={16} />
													</button>
												) : null}
												<button
													type="button"
													className="btn btn-sm btn-ghost-danger"
													title={intl.formatMessage({ id: "action.delete" })}
													disabled={busyId === cert.id}
													onClick={() => onDelete(cert.id)}
												>
													<IconTrash size={16} />
												</button>
											</HasPermission>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}

				<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
					<Formik
						initialValues={{
							name: "",
							validityDays: 365,
							format: "pkcs12",
							password: "",
						}}
						onSubmit={onIssue}
					>
						{({ values, isSubmitting, setFieldValue }: any) => (
							<Form>
								<h3 className="mt-2">
									<T id="client-certificate.issue" />
								</h3>
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<div className="row">
									<div className="col-md-8">
										<Field name="name" validate={validateString(1, 64)}>
											{({ field, form }: any) => (
												<div className="mb-3">
													<label htmlFor="certName" className="form-label">
														<T id="column.name" />
													</label>
													<input
														id="certName"
														type="text"
														required
														autoComplete="off"
														maxLength={64}
														className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
														{...field}
													/>
													{form.errors.name && form.touched.name ? (
														<div className="invalid-feedback">{form.errors.name}</div>
													) : null}
													<small className="form-hint">
														<T id="client-certificate.name.help" />
													</small>
												</div>
											)}
										</Field>
									</div>
									<div className="col-md-4">
										<Field name="validityDays" validate={validateNumber(1, 3650)}>
											{({ field, form }: any) => (
												<div className="mb-3">
													<label htmlFor="certValidityDays" className="form-label">
														<T id="client-certificate.validity-days" />
													</label>
													<input
														id="certValidityDays"
														type="number"
														required
														min={1}
														max={3650}
														className={`form-control ${form.errors.validityDays && form.touched.validityDays ? "is-invalid" : ""}`}
														{...field}
													/>
													{form.errors.validityDays && form.touched.validityDays ? (
														<div className="invalid-feedback">
															{form.errors.validityDays}
														</div>
													) : null}
													<small className="form-hint">
														<T id="client-certificate.validity-days.help" />
													</small>
												</div>
											)}
										</Field>
									</div>
								</div>
								<div className="row">
									<div className="col-md-6">
										<Field name="format">
											{({ field }: any) => (
												<div className="mb-3">
													<label htmlFor="certFormat" className="form-label">
														<T id="client-certificate.format" />
													</label>
													<select id="certFormat" className="form-select" {...field}>
														<option value="pkcs12">
															{intl.formatMessage({
																id: "client-certificate.format.pkcs12",
															})}
														</option>
														<option value="pem">
															{intl.formatMessage({
																id: "client-certificate.format.pem",
															})}
														</option>
													</select>
													<small className="form-hint">
														<T id="client-certificate.format.help" />
													</small>
												</div>
											)}
										</Field>
									</div>
									<div className="col-md-6">
										<Field
											name="password"
											validate={(value: string) =>
												values.format === "pkcs12" && !value
													? intl.formatMessage({ id: "error.required" })
													: undefined
											}
										>
											{({ field, form }: any) => (
												<div className="mb-3">
													<label htmlFor="certPassword" className="form-label">
														<T id="password" />
													</label>
													<input
														id="certPassword"
														type={showPassword ? "text" : "password"}
														autoComplete="new-password"
														maxLength={128}
														className={`form-control ${form.errors.password && form.touched.password ? "is-invalid" : ""}`}
														{...field}
													/>
													{form.errors.password && form.touched.password ? (
														<div className="invalid-feedback">{form.errors.password}</div>
													) : null}
													<small className="form-hint">
														<T
															id={
																values.format === "pkcs12"
																	? "client-certificate.password.help-pkcs12"
																	: "client-certificate.password.help-pem"
															}
														/>
														<br />
														<a
															href="#"
															onClick={(e) => {
																e.preventDefault();
																setFieldValue(
																	field.name,
																	generate({ length: 16, numbers: true }),
																);
																setShowPassword(true);
															}}
														>
															<T id="password.generate" />
														</a>{" "}
														&mdash;{" "}
														<a
															href="#"
															onClick={(e) => {
																e.preventDefault();
																setShowPassword(!showPassword);
															}}
														>
															<T id={showPassword ? "password.hide" : "password.show"} />
														</a>
													</small>
												</div>
											)}
										</Field>
									</div>
								</div>
								<Alert variant="info" className="mb-3">
									<T id="client-certificate.key-notice" />
								</Alert>
								<div className="text-end">
									<Button
										type="submit"
										actionType="primary"
										className="bg-teal"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="client-certificate.issue-download" />
									</Button>
								</div>
							</Form>
						)}
					</Formik>
				</HasPermission>
			</Modal.Body>
			<Modal.Footer>
				<Button data-bs-dismiss="modal" onClick={remove}>
					<T id="action.close" />
				</Button>
			</Modal.Footer>
		</Modal>
	);
});

export { showClientCertificatesModal };
