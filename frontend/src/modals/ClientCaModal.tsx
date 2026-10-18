import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import type { ClientCa } from "src/api/backend";
import { Button, Loading } from "src/components";
import { useClientCa, useSetClientCa } from "src/hooks";
import { T } from "src/locale";
import { validateNumber, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showClientCaModal = (id: number | "new") => {
	EasyModal.show(ClientCaModal, { id });
};

interface Props extends InnerModalProps {
	id: number | "new";
}
const ClientCaModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data, isLoading, error } = useClientCa(id);
	const { mutate: setClientCa } = useSetClientCa();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		setClientCa(
			{
				id: id === "new" ? undefined : id,
				name: values.name,
				validityDays: Number.parseInt(values.validityDays, 10),
			},
			{
				onError: (err: any) => setErrorMsg(<T id={err.message} />),
				onSuccess: () => {
					showObjectSuccess("client-ca", "saved");
					remove();
				},
				onSettled: () => {
					setIsSubmitting(false);
					setSubmitting(false);
				},
			},
		);
	};

	return (
		<Modal show={visible} onHide={remove}>
			{!isLoading && error && (
				<Alert variant="danger" className="m-3">
					{error?.message || "Unknown error"}
				</Alert>
			)}
			{isLoading && <Loading noLogo />}
			{!isLoading && data && (
				<Formik
					initialValues={
						{
							name: data?.name,
							validityDays: data?.validityDays,
						} as ClientCa
					}
					onSubmit={onSubmit}
				>
					{() => (
						<Form>
							<Modal.Header closeButton>
								<Modal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "client-ca" }} />
								</Modal.Title>
							</Modal.Header>
							<Modal.Body>
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<Field name="name" validate={validateString(1, 64)}>
									{({ field, form }: any) => (
										<div className="mb-3">
											<label htmlFor="name" className="form-label">
												<T id="column.name" />
											</label>
											<input
												id="name"
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
											{data?.id ? (
												<small className="form-hint">
													<T id="client-ca.name.help" />
												</small>
											) : null}
										</div>
									)}
								</Field>
								<Field name="validityDays" validate={validateNumber(30, 7300)}>
									{({ field, form }: any) => (
										<div className="mb-3">
											<label htmlFor="validityDays" className="form-label">
												<T id="client-ca.validity-days" />
											</label>
											<input
												id="validityDays"
												type="number"
												required
												min={30}
												max={7300}
												className={`form-control ${form.errors.validityDays && form.touched.validityDays ? "is-invalid" : ""}`}
												{...field}
											/>
											{form.errors.validityDays && form.touched.validityDays ? (
												<div className="invalid-feedback">{form.errors.validityDays}</div>
											) : null}
											<small className="form-hint">
												<T id="client-ca.validity-days.help" />
											</small>
										</div>
									)}
								</Field>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<Button
									type="submit"
									actionType="primary"
									className="ms-auto bg-teal"
									data-bs-dismiss="modal"
									isLoading={isSubmitting}
									disabled={isSubmitting}
								>
									<T id="save" />
								</Button>
							</Modal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</Modal>
	);
});

export { showClientCaModal };
