import { Field, useFormikContext } from "formik";
import Select, { type MultiValue } from "react-select";
import type { ClientCa } from "src/api/backend";
import { useClientCas } from "src/hooks";
import { intl, T } from "src/locale";

interface ClientCaOption {
	readonly value: number;
	readonly label: string;
}

interface Props {
	name?: string;
	id?: string;
}
export function ClientCasField({ name = "clientCaIds", id = "clientCaIds" }: Props) {
	const { isLoading, isError, error, data } = useClientCas();
	const { setFieldValue } = useFormikContext();

	const options: ClientCaOption[] =
		data?.map((item: ClientCa) => ({
			value: item.id || 0,
			label: item.name,
		})) || [];

	return (
		<Field name={name}>
			{({ field }: any) => (
				<div className="mb-3">
					<label className="form-label" htmlFor={id}>
						<T id="client-cas" />
					</label>
					{isLoading ? <div className="placeholder placeholder-lg col-12 my-3 placeholder-glow" /> : null}
					{isError ? <div className="invalid-feedback d-block">{`${error}`}</div> : null}
					{!isLoading && !isError ? (
						<Select
							inputId={id}
							isMulti
							className="react-select-container"
							classNamePrefix="react-select"
							placeholder={intl.formatMessage({ id: "access-list.mtls.placeholder" })}
							noOptionsMessage={() => intl.formatMessage({ id: "access-list.mtls.no-cas" })}
							value={options.filter((o) => (field.value || []).includes(o.value))}
							options={options}
							onChange={(selected: MultiValue<ClientCaOption>) => {
								setFieldValue(
									name,
									selected.map((o) => o.value),
								);
							}}
						/>
					) : null}
				</div>
			)}
		</Field>
	);
}
